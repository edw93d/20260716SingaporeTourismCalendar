import { execFileSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DB_PATH, FEEDS_DIR, SITE_DIR, SITE_PAYLOAD } from "../src/paths.js";

/**
 * The daily run is the one part of this project that nobody watches. Its
 * properties — off-the-hour scheduling, non-overlap, zero credentials, no
 * keepalive — are decisions taken once in a YAML file and then never read
 * again, which is exactly the shape of thing that rots silently.
 *
 * These guards are deliberately structural rather than behavioural. There is no
 * way to test a cron firing or a Pages deployment from here; what *can* be held
 * is that the file still says what the decision said.
 */

const WORKFLOWS = fileURLToPath(new URL("../.github/workflows", import.meta.url));

const workflowFiles = readdirSync(WORKFLOWS).filter((name) => /\.ya?ml$/.test(name));

const text = (name: string): string => readFileSync(join(WORKFLOWS, name), "utf8");

/**
 * Strips `#` comments, for the same reason `identifiersOnly` strips them from
 * TypeScript: a comment legitimately *discusses* the thing the guard forbids.
 * The workflow explains why `--allow-empty` is banned, and a text scan that read
 * its own rationale as a violation would make the rule unstateable.
 *
 * Comments cannot run, so nothing is lost by not scanning them. A `#` only opens
 * a comment at the start of a line or after whitespace — `refs/heads#1` is not a
 * comment, and neither is a fragment in a URL.
 */
const withoutComments = (yaml: string): string => yaml.replace(/(^|\s)#.*$/gm, "$1");

const DAILY = "daily.yml";

type Step = {
  name?: string;
  uses?: string;
  with?: Record<string, unknown>;
  run?: string;
  env?: Record<string, string>;
};

type Workflow = {
  on?: { schedule?: { cron?: string }[]; pull_request?: unknown; push?: { branches?: string[] } };
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  permissions?: Record<string, string> | string;
  // A job's `env` values are `string | number` because YAML says so: quoting is
  // optional, so `STALE_AFTER_HOURS: 48` parses as a number while the tokens
  // beside it parse as strings. Typing it `string` would be a lie the `Number()`
  // call below quietly covers for.
  jobs?: Record<string, { steps?: Step[]; env?: Record<string, string | number> }>;
};

const daily = parse(text(DAILY)) as Workflow;

const steps = Object.values(daily.jobs ?? {}).flatMap((job) => job.steps ?? []);

const crons = (daily.on?.schedule ?? []).map((entry) => entry.cron ?? "");

/** The five cron fields of the single schedule, named. */
const schedule = () => {
  const [minute, hour, dayOfMonth, month, dayOfWeek] = crons[0]!.split(/\s+/);
  return { minute: Number(minute), hour: Number(hour), dayOfMonth, month, dayOfWeek };
};

describe("the daily workflow", () => {
  it("exists and is the workflow the guards below are reading", () => {
    // Guards the guards: a rename would otherwise make every assertion vacuous.
    expect(workflowFiles).toContain(DAILY);
  });

  it("runs once a day, every day", () => {
    expect(crons).toHaveLength(1);

    const { dayOfMonth, month, dayOfWeek } = schedule();
    expect({ dayOfMonth, month, dayOfWeek }).toEqual({
      dayOfMonth: "*",
      month: "*",
      dayOfWeek: "*",
    });
  });

  it("is scheduled off the top of the hour", () => {
    // GitHub documents that scheduled runs may be dropped when the platform is
    // under load, and load concentrates on the minute everybody picked. A run we
    // never get is the failure this whole ticket is trying not to have.
    expect(schedule().minute).toBeGreaterThan(5);
    expect(schedule().minute).toBeLessThan(55);
  });

  it("carries a concurrency group that queues rather than cancels", () => {
    // The SQLite blob cannot merge, so two runs must never overlap. Cancelling
    // is worse than queueing here: a cancelled run may already have upserted,
    // and killing it mid-transaction is the one way to reach a torn store.
    expect(daily.concurrency?.group).toBeTruthy();
    expect(daily.concurrency?.["cancel-in-progress"]).toBe(false);
  });

  it("grants itself exactly the four permissions it uses, and no others", () => {
    // Scoped rather than `write-all`, and asserted exhaustively rather than with
    // toMatchObject: the failure worth catching is a *fifth* scope appearing,
    // which a partial match would wave through. `issues: write` is the breakage
    // alerter's (ADR-0007, #41) — `gh` raises and closes the operator's issues.
    expect(daily.permissions).toEqual({
      contents: "write",
      pages: "write",
      "id-token": "write",
      issues: "write",
    });
  });

  it("injects GITHUB_TOKEN into the pipeline step, so gh can authenticate", () => {
    // The breakage alerter (#41) shells out to `gh`, which reads the run-scoped
    // token from its environment. This is the one place a credential is named,
    // and it is `secrets.GITHUB_TOKEN` — the token Actions mints and expires with
    // the run — which the GITHUB_TOKEN-only guard below explicitly allows. No
    // token here would leave every `gh` call unauthenticated and every alert lost.
    const pipeline = steps.find((step) => /npm\s+run\s+pipeline/.test(step.run ?? ""));
    expect(pipeline?.env?.["GITHUB_TOKEN"]).toBe("${{ secrets.GITHUB_TOKEN }}");
  });

  it("commits the store and the feeds back to the repository", () => {
    // The store is the pipeline's whole memory; a run that did not write it back
    // would leave the next run scraping into an empty database and re-minting
    // every uid, which is the recompute UID forbids.
    const body = text(DAILY);
    expect(body).toContain(DB_PATH);
    expect(body).toContain(FEEDS_DIR);
    // The web calendar's data payload is committed beside the feeds (#38): the
    // page is built from it, and like the feeds it is the diffable record of what
    // the day's calendar holds, next to a store blob that only says *that* it
    // changed (ADR-0011).
    expect(body).toContain(SITE_PAYLOAD);
    expect(body).toMatch(/git\s+push/);
  });

  it("does not ask configure-pages to enable Pages", () => {
    // `enablement: true` asks the action to *create* the Pages site, which
    // `GITHUB_TOKEN` cannot do — `pages: write` deploys to an existing site, but
    // creating one is administrative. Setting it does not degrade to a no-op: it
    // fails the step, and with it the publish (#46). Pages-enabled is repository
    // state set once by hand, recorded in ADR-0011.
    //
    // Read from the parsed step rather than the text, so the comment above the
    // step is free to name the flag it forbids.
    const configure = steps.find((step) => step.uses?.startsWith("actions/configure-pages"));
    expect(configure).toBeDefined();
    expect(configure?.with?.enablement).toBeUndefined();
  });

  it("publishes the site directory to Pages", () => {
    const upload = steps.find((step) => step.uses?.startsWith("actions/upload-pages-artifact"));
    expect(upload?.with?.path).toBe(SITE_DIR);
    expect(steps.some((step) => step.uses?.startsWith("actions/deploy-pages"))).toBe(true);
  });

  it("installs the headless browser before running the pipeline", () => {
    // MBCCS is scraped through a real Chromium session (ADR-0005, Amendment 2),
    // which is not on the runner unless this step puts it there. Criterion 12 of
    // #37 (no credential) is already test-enforced; criterion 11 — Playwright
    // runs in the daily workflow — was not, so a future edit dropping the step
    // would break the one source that needs a browser with the suite still
    // green (#50). This holds the step exists and precedes the pipeline run.
    const install = steps.findIndex((step) => /playwright\s+install/.test(step.run ?? ""));
    const pipeline = steps.findIndex((step) => /npm\s+run\s+pipeline/.test(step.run ?? ""));
    expect(install).toBeGreaterThanOrEqual(0);
    expect(pipeline).toBeGreaterThan(install);
  });
});

const FRESHNESS = "freshness.yml";

const freshness = parse(text(FRESHNESS)) as Workflow;

const freshnessJobs = Object.values(freshness.jobs ?? {});

const freshnessSteps = freshnessJobs.flatMap((job) => job.steps ?? []);

/** A cron's fire time as minutes past midnight UTC. */
const fireMinute = (workflow: Workflow): number => {
  const [minute, hour] = (workflow.on?.schedule ?? [])[0]!.cron!.split(/\s+/);
  return Number(hour) * 60 + Number(minute);
};

describe("the freshness watcher", () => {
  it("exists and is the workflow the guards below are reading", () => {
    // Guards the guards: a rename would otherwise make every assertion vacuous.
    expect(workflowFiles).toContain(FRESHNESS);
  });

  it("runs once a day, off the top of the hour", () => {
    // Off the hour for the same reason `daily.yml` is: GitHub drops scheduled
    // runs under load, and load concentrates on the minute everybody picked.
    const crons = (freshness.on?.schedule ?? []).map((entry) => entry.cron ?? "");
    expect(crons).toHaveLength(1);

    const [minute, , dayOfMonth, month, dayOfWeek] = crons[0]!.split(/\s+/);
    expect({ dayOfMonth, month, dayOfWeek }).toEqual({
      dayOfMonth: "*",
      month: "*",
      dayOfWeek: "*",
    });
    expect(Number(minute)).toBeGreaterThan(5);
    expect(Number(minute)).toBeLessThan(55);
  });

  it("grants itself the right to write an issue and nothing else", () => {
    // Asserted exhaustively, like the daily job's: the failure worth catching is
    // a *second* scope appearing. `contents: write` in particular would make the
    // watcher a writer of the repository it watches — and a workflow that can
    // commit is one edit away from being the dummy-commit trick #19 bans. With
    // no write scope, that is foreclosed structurally rather than by the grep.
    expect(freshness.permissions).toEqual({ issues: "write" });
  });

  it("checks out nothing and runs no npm or node step", () => {
    // **The watcher's defining property is independence** (ADR-0013). It exists
    // to observe a pipeline that may be broken, so it must not share that
    // pipeline's failure modes: a checkout lets a broken repository break it, and
    // `npm ci` lets a broken build, a bad lockfile, or a failed dependency
    // install silence the one thing that would have reported the silence.
    //
    // This is the guard that stops that being undone for convenience. Without
    // it, a future edit adds a checkout to reuse `src/alerts`, and the alarm
    // quietly inherits everything it was built to be immune to.
    expect(freshnessSteps.some((step) => step.uses?.startsWith("actions/checkout"))).toBe(false);
    expect(freshnessSteps.some((step) => /\b(npm|npx|node)\b/.test(step.run ?? ""))).toBe(false);
    expect(freshnessSteps.some((step) => step.uses?.startsWith("actions/setup-node"))).toBe(false);
  });

  describe("recognising its own open alarm", () => {
    // **Observed, not theorised: the first live dispatch of this workflow closed
    // #64** — the ticket asking for that dispatch, which quotes the marker in
    // its checklist. The lookup matched the marker anywhere in any open body, so
    // writing about the alarm made you the alarm, and a healthy calendar closed
    // you as recovered.
    //
    // **This runs the real jq program rather than grepping for its spelling.**
    // A text scan for `endswith(` would pass on a rewrite that keeps the word
    // and breaks the behaviour, and fail on a correct rewrite that spells it
    // another way — it locks a string, not a property. The program is lifted out
    // of the YAML and executed against bodies of each shape that matters.
    //
    // ADR-0013 accepts that this policy has no unit tests, because a watcher
    // sharing the build's toolchain shares its failure modes. That is untouched:
    // this shells out to `jq`, which the runner has and the pipeline does not
    // supply, and it runs in the test suite rather than inside the watcher.
    const script = freshnessSteps.map((step) => step.run ?? "").join("\n");

    const program = script.match(/jq -r --arg marker "\$MARKER" \\\n\s*'([^']*)'/)?.[1];

    const MARKER = String(freshnessJobs[0]?.env?.["MARKER"]);

    /** The workflow's own selector, run over a `gh issue list --json` payload. */
    const select = (issues: unknown[]): string =>
      execFileSync("jq", ["-r", "--arg", "marker", MARKER, program!], {
        input: JSON.stringify(issues),
        encoding: "utf8",
      }).trim();

    const bot = (number: number, body: string) => ({ number, body, author: { is_bot: true } });
    const human = (number: number, body: string) => ({ number, body, author: { is_bot: false } });

    it("lifts the selector out of the workflow", () => {
      // Guards the guard: a reformat that this regex stops matching would make
      // every assertion below silently vacuous.
      expect(program).toBeTruthy();
      expect(MARKER).toMatch(/^<!--.*-->$/);
    });

    it("asks for the author field it filters on", () => {
      // The filter is only as good as the listing: `gh` omits `author` unless it
      // is requested, and every issue would then read as not-a-bot — no alarm
      // ever recognised, a duplicate opened every single day.
      expect(script).toMatch(/gh issue list [^\n]*--json number,body,author/);
    });

    it("adopts its own open alarm", () => {
      expect(select([bot(65, `stale\n\n${MARKER}\n`)])).toBe("65");
    });

    it("ignores a human issue that merely quotes the marker", () => {
      // #64's exact shape, and the reason this ticket exists.
      expect(select([human(64, `verify the body ends with \`${MARKER}\``)])).toBe("");
    });

    it("ignores a human issue that ends with the marker", () => {
      // Anchoring the marker to the end of the body would also have fixed #64,
      // but only for markers quoted mid-body. Authorship does not care where.
      expect(select([human(64, `see ${MARKER}`)])).toBe("");
    });

    it("still recognises its alarm after a triager appends to the body", () => {
      // **The property the marker exists for** (see its `env:` comment): it sits
      // in the body so retitling cannot orphan it. Identifying the alarm by
      // *where* the marker sits would give that back — one appended triage note
      // and the alarm opens a duplicate daily and never auto-closes. Editing an
      // issue does not change its author.
      expect(select([bot(65, `stale\n\n${MARKER}\n\ntriage: pages deploy, see #70`)])).toBe("65");
    });

    it("picks the lowest number when duplicates somehow exist", () => {
      // Which one is adopted must not depend on the order the API listed them,
      // or a recovery run closes an arbitrary one of the pair.
      expect(select([bot(88, MARKER), bot(65, MARKER)])).toBe("65");
    });

    it("survives a null body and a missing author", () => {
      expect(select([{ number: 9, body: null, author: null }, { number: 10 }])).toBe("");
    });
  });

  it("tolerates exactly one missed daily run, and alarms on the second", () => {
    // **This holds the reasoning behind the threshold, not the number.**
    //
    // `daily.yml`'s cron comment explicitly tolerates a dropped run — "a dropped
    // run costs a day of freshness and nothing else (the store is upserted, so
    // the next run heals it)". An alarm that fires on one miss therefore alarms
    // on something the design already accepted, and gets ignored.
    //
    // The watcher fires a fixed offset after the pipeline, so the age it observes
    // is offset + 24h per missed run. The threshold has to separate one miss from
    // two — and that is a relationship between *three* values (both crons and the
    // threshold), which is exactly the kind of thing that silently stops holding
    // when someone moves one of them. Moving either cron now fails here.
    const offsetHours = (((fireMinute(freshness) - fireMinute(daily) + 1440) % 1440) / 60);

    // **The offset must clear the pipeline itself**, or every number below is
    // wrong by a day. The pipeline scrapes three sources — one through a real
    // Chromium session — commits, and waits on a Pages deploy and its CDN; a
    // watcher firing minutes after it *starts* reads yesterday's artifact on a
    // perfectly healthy day, which reads as one missed run. The margin does not
    // shrink, it silently shifts, and the alarm alarms on nothing.
    expect(offsetHours).toBeGreaterThanOrEqual(2);

    const afterOneMiss = offsetHours + 24;
    const afterTwoMisses = offsetHours + 48;

    const threshold = Number(freshnessJobs[0]?.env?.["STALE_AFTER_HOURS"]);
    expect(Number.isFinite(threshold)).toBe(true);

    expect(threshold).toBeGreaterThan(afterOneMiss);
    expect(threshold).toBeLessThan(afterTwoMisses);
  });

  it("reads the published site over HTTPS, not the repository", () => {
    // Freshness is what *a reader actually reaches* (CONTEXT.md). The commit-back
    // and the Pages deploy are separate steps that fail separately, so a watcher
    // reading the committed file would report fresh while every reader saw a
    // frozen page. Only the published URL observes the thing end to end.
    const body = text(FRESHNESS);
    expect(body).toMatch(/https:\/\/[a-z0-9-]+\.github\.io\//i);
    expect(body).toContain("calendar.json");
  });
});

const CI = "ci.yml";

const ci = parse(text(CI)) as Workflow;

const ciOn = ci.on as { pull_request?: unknown; push?: { branches?: string[] } };

const ciSteps = Object.values(ci.jobs ?? {}).flatMap((job) => job.steps ?? []);

describe("the CI workflow", () => {
  it("exists and is the workflow the guards below are reading", () => {
    // Guards the guards: a rename would otherwise make every assertion vacuous.
    expect(workflowFiles).toContain(CI);
  });

  it("runs on pull requests and on pushes to main", () => {
    // The whole point of the file (#45): before it, nothing ran on a PR, so
    // every test-enforced decision in this repo was a no-op on the change that
    // broke it. The push trigger catches a merge that lands without a PR.
    expect(ciOn.pull_request).toBeDefined();
    expect(ciOn.push?.branches).toEqual(["main"]);
  });

  it("carries a concurrency group that cancels rather than queues", () => {
    // The inverse of the daily pipeline, and correct for the inverse reason: a
    // check run writes nothing, so a superseded run has nothing to tear and no
    // result worth finishing. Pushing twice should grade the tip, not the stale
    // commit. The group is keyed on the ref so distinct branches never contend.
    expect(ci.concurrency?.group).toBeTruthy();
    expect(ci.concurrency?.["cancel-in-progress"]).toBe(true);
  });

  it("grants itself read access to the code and nothing more", () => {
    // Asserted exhaustively rather than with toMatchObject: the failure worth
    // catching is a *write* scope appearing on a job that only reports a status.
    expect(ci.permissions).toEqual({ contents: "read" });
  });

  it("runs the typecheck and the test suite", () => {
    // The gate's substance. Both are asserted so that dropping either — the
    // cheaper failure to overlook — fails this test rather than silently
    // narrowing what a green check means.
    const runs = ciSteps.map((step) => step.run ?? "");
    expect(runs.some((run) => /npm\s+run\s+typecheck/.test(run))).toBe(true);
    expect(runs.some((run) => /npm\s+test/.test(run))).toBe(true);
  });

  it("pins the same Node version as the daily pipeline", () => {
    // A version skew is how a suite goes green here and breaks in production for
    // a reason that has nothing to do with the change under review.
    const nodeOf = (workflow: Workflow) =>
      Object.values(workflow.jobs ?? {})
        .flatMap((job) => job.steps ?? [])
        .find((step) => step.uses?.startsWith("actions/setup-node"))?.with?.["node-version"];
    expect(nodeOf(ci)).toBe(nodeOf(daily));
  });
});

describe("every workflow", () => {
  const all = workflowFiles.map((name) => ({ name, body: withoutComments(text(name)) }));

  it("has workflows to check", () => {
    // Guards the guards: an empty glob would make both scans below vacuous.
    expect(all.length).toBeGreaterThan(0);
  });

  it("authenticates with GITHUB_TOKEN and nothing else", () => {
    // v1 has zero credentials end to end. A secret reference here is the first
    // step of walking that property back — and the architecture test's ban on
    // process.env reads in src/ is only half the guard without this one.
    const offenders = all
      .flatMap(({ name, body }) =>
        [...body.matchAll(/secrets\.([A-Za-z0-9_]+)/g)].map((match) => `${name}: ${match[1]}`),
      )
      .filter((reference) => !reference.endsWith("GITHUB_TOKEN"));

    expect(offenders).toEqual([]);
  });

  it("adds no keepalive of any kind", () => {
    // Banned by #19, in both its forms. GitHub disables scheduled workflows in a
    // repository with 60 days of no activity; a dummy commit or a preemptive
    // re-enable would defeat that, and both are ToS-adjacent. The decision was
    // to let it happen and observe it, so the ban has to be enforceable.
    const offenders = all
      .filter(({ body }) =>
        /--allow-empty|workflow\s+enable|keepalive|keep-alive|gh\s+api.*\/enable/i.test(body),
      )
      .map(({ name }) => name);

    expect(offenders).toEqual([]);
  });
});
