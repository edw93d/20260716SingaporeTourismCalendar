import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { DB_PATH, FEEDS_DIR, SITE_DIR } from "../src/paths.js";

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

type Workflow = {
  on?: { schedule?: { cron?: string }[] };
  concurrency?: { group?: string; "cancel-in-progress"?: boolean };
  permissions?: Record<string, string> | string;
  jobs?: Record<string, { steps?: { uses?: string; with?: Record<string, unknown> }[] }>;
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

  it("grants itself exactly the three permissions it uses, and no others", () => {
    // Scoped rather than `write-all`, and asserted exhaustively rather than with
    // toMatchObject: the failure worth catching is a *fourth* scope appearing,
    // which a partial match would wave through.
    expect(daily.permissions).toEqual({
      contents: "write",
      pages: "write",
      "id-token": "write",
    });
  });

  it("commits the store and the feeds back to the repository", () => {
    // The store is the pipeline's whole memory; a run that did not write it back
    // would leave the next run scraping into an empty database and re-minting
    // every uid, which is the recompute UID forbids.
    const body = text(DAILY);
    expect(body).toContain(DB_PATH);
    expect(body).toContain(FEEDS_DIR);
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
