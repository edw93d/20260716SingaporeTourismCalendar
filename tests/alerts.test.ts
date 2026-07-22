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
} from "../src/alerts/issues.js";

/**
 * The alerting layer (ADR-0007 §6): the open-once / auto-close policy driven
 * against a fake gateway, the issue rendering, and the `gh`-backed gateway's
 * marker-scan identity — all without touching GitHub.
 */

/** An in-memory gateway that records what the reconciler asked of it. */
const fakeGateway = (open: Record<SourceId, OpenIssue> = {}) => {
  const calls = {
    opened: [] as { source: SourceId; title: string; body: string }[],
    closed: [] as { issue: OpenIssue; comment: string }[],
  };
  const gateway: IssueGateway = {
    findOpen: async (source) => open[source] ?? null,
    open: async (source, title, body) => {
      calls.opened.push({ source, title, body });
    },
    close: async (issue, comment) => {
      calls.closed.push({ issue, comment });
    },
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
    const { gateway, calls } = fakeGateway({ scc: { number: 7 } });

    await reconcile([broken("scc", [unreadable])], gateway);

    expect(calls.opened).toEqual([]);
    expect(calls.closed).toEqual([]);
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

  it("tolerates a null body in the issue list without throwing", async () => {
    const gh: Gh = async () => JSON.stringify([{ number: 1, body: null }]);
    expect(await createGhGateway(gh).findOpen("scc")).toBeNull();
  });
});
