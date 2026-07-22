import { describe, expect, it, vi } from "vitest";
import type { SourceId } from "../src/domain/types.js";
import type { BreakageSignal } from "../src/pipeline/breakage.js";
import type { SourceBreakage } from "../src/pipeline/run.js";
import { createGhGateway, type Gh } from "../src/alerts/gh.js";
import {
  type IssueGateway,
  type OpenIssue,
  issueBody,
  issueTitle,
  markerFor,
  reconcile,
  signalMarker,
} from "../src/alerts/issues.js";

/**
 * The alerting layer (ADR-0007 §6): the open-once / auto-close policy driven
 * against a fake gateway, the issue rendering, and the `gh`-backed gateway's
 * marker-scan identity — all without touching GitHub.
 */

/**
 * An in-memory gateway that records what the reconciler asked of it. `landed`
 * seeds which signal kinds a source's open issue already carries, keyed by
 * source so a test reads the way the run does.
 */
const fakeGateway = (
  open: Record<SourceId, OpenIssue> = {},
  landed: Partial<Record<SourceId, BreakageSignal["kind"][]>> = {},
) => {
  const kindsByNumber = new Map<number, BreakageSignal["kind"][]>();
  for (const [source, issue] of Object.entries(open)) {
    kindsByNumber.set(issue.number, landed[source as SourceId] ?? []);
  }
  const calls = {
    opened: [] as { source: SourceId; title: string; body: string }[],
    closed: [] as { issue: OpenIssue; comment: string }[],
    commented: [] as { issue: OpenIssue; body: string }[],
  };
  const gateway: IssueGateway = {
    findOpen: async (source) => open[source] ?? null,
    open: async (source, title, body) => {
      calls.opened.push({ source, title, body });
    },
    close: async (issue, comment) => {
      calls.closed.push({ issue, comment });
    },
    comment: async (issue, body) => {
      calls.commented.push({ issue, body });
    },
    landed: async (issue) => kindsByNumber.get(issue.number) ?? [],
  };
  return { gateway, calls };
};

const broken = (source: SourceId, signals: BreakageSignal[]): SourceBreakage => ({ source, signals });
const healthy = (source: SourceId): SourceBreakage => ({ source, signals: [] });

const unreadable: BreakageSignal = { kind: "unreadable", reason: "listing anchor absent" };

describe("reconcile", () => {
  it("opens one issue when a source is newly broken", async () => {
    const { gateway, calls } = fakeGateway();

    await reconcile([broken("scc", [unreadable])], gateway);

    expect(calls.opened).toHaveLength(1);
    expect(calls.opened[0]).toMatchObject({ source: "scc", title: "Scraper unhealthy: scc" });
    expect(calls.closed).toEqual([]);
  });

  it("does not open a second issue when one is already open — one per source", async () => {
    const { gateway, calls } = fakeGateway({ scc: { number: 7 } }, { scc: ["unreadable"] });

    await reconcile([broken("scc", [unreadable])], gateway);

    expect(calls.opened).toEqual([]);
    expect(calls.closed).toEqual([]);
  });

  it("appends a comment when a later run surfaces a signal kind not yet on the open issue", async () => {
    // scc first tripped only cohort-drop; the issue carries that kind. A later
    // run, still broken, now also fails rows — that detail must reach the issue.
    const { gateway, calls } = fakeGateway({ scc: { number: 7 } }, { scc: ["cohort-drop"] });
    const rowsFailed: BreakageSignal = {
      kind: "rows-failed",
      failures: [{ fragment: "<article data-broken/>", expected: "a start instant" }],
    };

    await reconcile([broken("scc", [rowsFailed])], gateway);

    expect(calls.opened).toEqual([]);
    expect(calls.commented).toHaveLength(1);
    expect(calls.commented[0]?.issue).toEqual({ number: 7 });
    // Carries the same debugging detail the body would, plus its kind marker.
    expect(calls.commented[0]?.body).toContain("a start instant");
    expect(calls.commented[0]?.body).toContain("<article data-broken/>");
    expect(calls.commented[0]?.body).toContain(signalMarker("rows-failed"));
  });

  it("does not re-comment a signal kind already present on the open issue", async () => {
    const { gateway, calls } = fakeGateway({ scc: { number: 7 } }, { scc: ["rows-failed"] });
    const rowsFailed: BreakageSignal = {
      kind: "rows-failed",
      failures: [{ fragment: "<article/>", expected: "a start instant" }],
    };

    await reconcile([broken("scc", [rowsFailed])], gateway);

    expect(calls.commented).toEqual([]);
    expect(calls.opened).toEqual([]);
    expect(calls.closed).toEqual([]);
  });

  it("appends only the genuinely new kinds when a run mixes present and new signals", async () => {
    const { gateway, calls } = fakeGateway({ scc: { number: 7 } }, { scc: ["cohort-drop"] });
    const rowsFailed: BreakageSignal = {
      kind: "rows-failed",
      failures: [{ fragment: "<article/>", expected: "a start instant" }],
    };
    const cohortDrop: BreakageSignal = { kind: "cohort-drop", vanished: 18, appeared: 2 };

    await reconcile([broken("scc", [rowsFailed, cohortDrop])], gateway);

    expect(calls.commented).toHaveLength(1);
    expect(calls.commented[0]?.body).toContain(signalMarker("rows-failed"));
    expect(calls.commented[0]?.body).not.toContain(signalMarker("cohort-drop"));
  });

  it("closes the open issue when the source recovers", async () => {
    const { gateway, calls } = fakeGateway({ scc: { number: 7 } });

    await reconcile([healthy("scc")], gateway);

    expect(calls.closed).toHaveLength(1);
    expect(calls.closed[0]?.issue).toEqual({ number: 7 });
    expect(calls.closed[0]?.comment).toContain("scc");
    expect(calls.opened).toEqual([]);
  });

  it("does nothing for a healthy source with no open issue", async () => {
    const { gateway, calls } = fakeGateway();

    await reconcile([healthy("suntec")], gateway);

    expect(calls.opened).toEqual([]);
    expect(calls.closed).toEqual([]);
  });

  it("reconciles each source independently in one run", async () => {
    const { gateway, calls } = fakeGateway({ suntec: { number: 3 } });

    await reconcile(
      [broken("scc", [unreadable]), healthy("suntec"), healthy("mbccs")],
      gateway,
    );

    expect(calls.opened.map((c) => c.source)).toEqual(["scc"]);
    expect(calls.closed.map((c) => c.issue.number)).toEqual([3]);
  });

  it("attempts every source even when one gateway call throws, then reports the failure", async () => {
    const calls: SourceId[] = [];
    const gateway: IssueGateway = {
      findOpen: async (source) => {
        calls.push(source);
        if (source === "scc") throw new Error("gh unavailable");
        return null;
      },
      open: async () => {},
      close: async () => {},
      comment: async () => {},
      landed: async () => [],
    };

    await expect(
      reconcile([broken("scc", [unreadable]), broken("suntec", [unreadable])], gateway),
    ).rejects.toThrow(/reconciliation failed/);

    // suntec was still attempted despite scc throwing first.
    expect(calls).toEqual(["scc", "suntec"]);
  });
});

describe("issue rendering", () => {
  it("titles the issue by source and hides a title-edit-proof identity marker in the body", () => {
    expect(issueTitle("scc")).toBe("Scraper unhealthy: scc");
    expect(issueBody("scc", [unreadable])).toContain(markerFor("scc"));
  });

  it("carries the failing fragment and what was expected, so it is debuggable without re-scraping", () => {
    const body = issueBody("suntec", [
      {
        kind: "rows-failed",
        failures: [{ fragment: "<article data-broken/>", expected: "a start instant" }],
      },
    ]);

    expect(body).toContain("a start instant");
    expect(body).toContain("<article data-broken/>");
  });

  it("reports the net drop and its parts for a cohort-drop signal", () => {
    const body = issueBody("scc", [{ kind: "cohort-drop", vanished: 18, appeared: 2 }]);

    expect(body).toContain("18");
    expect(body).toContain("16"); // net drop = vanished − appeared
  });

  it("embeds a per-kind marker for each signal, so a later run can see what landed", () => {
    const body = issueBody("scc", [
      { kind: "cohort-drop", vanished: 18, appeared: 2 },
    ]);

    expect(body).toContain(signalMarker("cohort-drop"));
    expect(body).not.toContain(signalMarker("rows-failed"));
  });
});

describe("the gh-backed gateway", () => {
  it("finds a source's open issue by scanning bodies for its marker", async () => {
    const gh: Gh = vi.fn(async () =>
      JSON.stringify([
        { number: 1, body: "unrelated issue" },
        { number: 9, body: `broken\n${markerFor("scc")}` },
      ]),
    );

    const found = await createGhGateway(gh).findOpen("scc");
    expect(found).toEqual({ number: 9 });
  });

  it("returns null when no open issue carries the source's marker", async () => {
    const gh: Gh = async () => JSON.stringify([{ number: 1, body: markerFor("suntec") }]);
    expect(await createGhGateway(gh).findOpen("scc")).toBeNull();
  });

  it("creates an issue with the given title and body via gh", async () => {
    const gh = vi.fn<Gh>(async () => "");
    await createGhGateway(gh).open("scc", "Scraper unhealthy: scc", "body text");

    expect(gh).toHaveBeenCalledWith([
      "issue",
      "create",
      "--title",
      "Scraper unhealthy: scc",
      "--body",
      "body text",
    ]);
  });

  it("closes an issue with a comment via gh", async () => {
    const gh = vi.fn<Gh>(async () => "");
    await createGhGateway(gh).close({ number: 7 }, "recovered");

    expect(gh).toHaveBeenCalledWith(["issue", "close", "7", "--comment", "recovered"]);
  });

  it("appends a comment to an issue via gh", async () => {
    const gh = vi.fn<Gh>(async () => "");
    await createGhGateway(gh).comment({ number: 7 }, "a new signal");

    expect(gh).toHaveBeenCalledWith(["issue", "comment", "7", "--body", "a new signal"]);
  });

  it("reads landed signal kinds from the issue body and its comments", async () => {
    const gh: Gh = async () =>
      JSON.stringify({
        body: `broken\n${signalMarker("cohort-drop")}\n${markerFor("scc")}`,
        comments: [{ body: `late signal\n${signalMarker("rows-failed")}` }],
      });

    const kinds = await createGhGateway(gh).landed({ number: 9 });
    expect(kinds).toEqual(["rows-failed", "cohort-drop"]);
  });

  it("returns no landed kinds when body and comments carry no marker", async () => {
    const gh: Gh = async () => JSON.stringify({ body: "hand-written note", comments: [] });
    expect(await createGhGateway(gh).landed({ number: 9 })).toEqual([]);
  });

  it("tolerates a null body when reading landed kinds", async () => {
    const gh: Gh = async () =>
      JSON.stringify({ body: null, comments: [{ body: signalMarker("unreadable") }] });
    expect(await createGhGateway(gh).landed({ number: 9 })).toEqual(["unreadable"]);
  });

  it("recognises a kind on a pre-#55 issue whose body predates signal markers", async () => {
    // #41 opened issues without <!-- signal:* --> markers; the rendered section
    // heading is the fallback, so a markerless body is not re-commented daily.
    const gh: Gh = async () =>
      JSON.stringify({
        body: "### The future-dated cohort dropped\n- net drop: **16**",
        comments: [],
      });
    expect(await createGhGateway(gh).landed({ number: 9 })).toEqual(["cohort-drop"]);
  });

  it("tolerates a null body in the issue list without throwing", async () => {
    const gh: Gh = async () => JSON.stringify([{ number: 1, body: null }]);
    expect(await createGhGateway(gh).findOpen("scc")).toBeNull();
  });
});
