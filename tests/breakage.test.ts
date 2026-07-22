import { describe, expect, it } from "vitest";
import { instant } from "../src/domain/instant.js";
import type { PortCall, Scraped, VenueEvent } from "../src/domain/types.js";
import { assess, cohortDelta, NET_DROP_THRESHOLD } from "../src/pipeline/breakage.js";
import type { SourceOutcome } from "../src/pipeline/run.js";
import type { ParseFailure } from "../src/sources/types.js";

/**
 * The core's breakage detection (ADR-0007): the cross-run cohort comparison a
 * parser structurally cannot make, and the mapping from an outcome to the
 * signals the alerting layer acts on.
 */

const NOW = new Date("2026-07-10T00:00:00Z");

/** A stored future-dated port call — the SCC shape, `sourceKey` = `{vessel}|{date}`. */
const stored = (overrides: Partial<PortCall> = {}): PortCall => ({
  uid: `uid-${overrides.sourceKey ?? "default"}`,
  sequence: 0,
  source: "scc",
  sourceKey: "SHIP|2026-08-01",
  vessel: "SHIP",
  terminal: "Singapore Cruise Centre",
  berth: null,
  arrival: instant("2026-08-01T00:00:00Z"),
  departure: instant("2026-08-01T10:00:00Z"),
  firstSeenAt: instant("2026-07-09T00:00:00Z"),
  lastSeenAt: instant("2026-07-09T00:00:00Z"),
  ...overrides,
});

/** What the same source returns this run — no memory fields. */
const observed = (overrides: Partial<Scraped<PortCall>> = {}): Scraped<PortCall> => ({
  source: "scc",
  sourceKey: "SHIP|2026-08-01",
  vessel: "SHIP",
  terminal: "Singapore Cruise Centre",
  berth: null,
  arrival: instant("2026-08-01T00:00:00Z"),
  departure: instant("2026-08-01T10:00:00Z"),
  ...overrides,
});

const sailings = (n: number, seenAt: string): PortCall[] =>
  Array.from({ length: n }, (_, i) =>
    stored({
      sourceKey: `SHIP-${i}|2026-08-01`,
      lastSeenAt: instant(seenAt),
    }),
  );

describe("cohortDelta", () => {
  it("registers no vanishings on a cold start — there is no previous run to drop from", () => {
    // The first run for a source has no previous cohort, so nothing can vanish and
    // a drop (`vanished − appeared`) can never reach the threshold. A new future
    // record counting as an appearance is harmless — it can only soften a drop.
    expect(cohortDelta([], [observed()], NOW)).toEqual({ vanished: 0, appeared: 1 });
  });

  it("counts a future-dated record present last run and absent now as vanished", () => {
    const previous = sailings(5, "2026-07-09T00:00:00Z");
    // Only two of the five come back.
    const observedNow = [
      observed({ sourceKey: "SHIP-0|2026-08-01" }),
      observed({ sourceKey: "SHIP-1|2026-08-01" }),
    ];

    expect(cohortDelta(previous, observedNow, NOW)).toEqual({ vanished: 3, appeared: 0 });
  });

  it("nets a reschedule to zero — one key out, one key in", () => {
    // SCC's built-in false positive: a reschedule is a delete-plus-create, so the
    // old dated key vanishes and a new dated key appears. Netting silences it.
    const previous = [stored({ sourceKey: "SHIP|2026-08-01" })];
    const observedNow = [observed({ sourceKey: "SHIP|2026-08-02" })];

    expect(cohortDelta(previous, observedNow, NOW)).toEqual({ vanished: 1, appeared: 1 });
  });

  it("does not count a record that merely happened — it exited by date, not by vanishing", () => {
    // Future last run, past now: excluded from the previous cohort entirely, so
    // its absence from today's listing is not a vanish.
    const past = stored({
      sourceKey: "SHIP-PAST|2026-07-05",
      departure: instant("2026-07-05T10:00:00Z"),
    });
    const stillFuture = stored({ sourceKey: "SHIP-FUTURE|2026-08-01" });

    // Neither comes back this run, but only the future one should register.
    expect(cohortDelta([past, stillFuture], [], NOW)).toEqual({ vanished: 1, appeared: 0 });
  });

  it("does not count a still-listed record as vanished when it slips into the past between runs", () => {
    // Future last run, past now, but still on the listing: neither a vanish (it is
    // observed) nor a member of the present future cohort.
    const crossing = stored({
      sourceKey: "SHIP|2026-07-05",
      departure: instant("2026-07-05T10:00:00Z"),
    });
    const observedNow = [observed({ sourceKey: "SHIP|2026-07-05", departure: instant("2026-07-05T10:00:00Z") })];

    expect(cohortDelta([crossing], observedNow, NOW)).toEqual({ vanished: 0, appeared: 0 });
  });

  it("scopes the previous cohort to the last run, not to every record ever seen", () => {
    // A record that stopped appearing days ago carries an older lastSeenAt. It is
    // retained forever (ADR-0004) but must not be re-counted as vanishing daily.
    const longGone = stored({
      sourceKey: "SHIP-OLD|2026-08-01",
      lastSeenAt: instant("2026-07-01T00:00:00Z"),
    });
    const lastRun = stored({
      sourceKey: "SHIP-NEW|2026-08-01",
      lastSeenAt: instant("2026-07-09T00:00:00Z"),
    });

    // Only lastRun defines the cohort; it comes back, so nothing vanished.
    expect(cohortDelta([longGone, lastRun], [observed({ sourceKey: "SHIP-NEW|2026-08-01" })], NOW)).toEqual(
      { vanished: 0, appeared: 0 },
    );
  });

  it("works across record types — a VenueEvent's end is its cohort boundary", () => {
    const venue: VenueEvent = {
      uid: "uid-v",
      sequence: 0,
      source: "suntec",
      sourceKey: "expo-1",
      name: "Expo",
      start: instant("2026-08-01T04:00:00Z"),
      end: instant("2026-08-01T10:00:00Z"),
      venue: "Suntec",
      hall: null,
      firstSeenAt: instant("2026-07-09T00:00:00Z"),
      lastSeenAt: instant("2026-07-09T00:00:00Z"),
    };

    expect(cohortDelta([venue], [], NOW)).toEqual({ vanished: 1, appeared: 0 });
  });
});

const ok = (records: number, failures: ParseFailure[] = []): SourceOutcome => ({
  source: "scc",
  ok: true,
  records,
  failures,
});

const notOk = (reason: string): SourceOutcome => ({ source: "scc", ok: false, reason });

describe("assess", () => {
  it("raises an unreadable signal for a not-ok outcome and skips drift entirely", () => {
    // ADR-0007 §4: anchor absent reads as a 100% drop; firing a cohort alert on
    // top of the honest "the page isn't ours" would be a second, misleading one.
    expect(assess(notOk("listing anchor absent"), null)).toEqual([
      { kind: "unreadable", reason: "listing anchor absent" },
    ]);
  });

  it("raises a rows-failed signal carrying the failures, while the good records already landed", () => {
    const failures: ParseFailure[] = [{ fragment: "<tr/>", expected: "a departure instant" }];
    expect(assess(ok(5, failures), { vanished: 0, appeared: 0 })).toEqual([
      { kind: "rows-failed", failures },
    ]);
  });

  it("raises a cohort-drop signal when the net drop meets the threshold", () => {
    expect(assess(ok(3), { vanished: NET_DROP_THRESHOLD, appeared: 0 })).toEqual([
      { kind: "cohort-drop", vanished: NET_DROP_THRESHOLD, appeared: 0 },
    ]);
  });

  it("does not raise on a net drop of one below the threshold", () => {
    expect(assess(ok(3), { vanished: NET_DROP_THRESHOLD - 1, appeared: 0 })).toEqual([]);
  });

  it("lets appearances offset vanishings before the threshold is applied", () => {
    // Five out, three in nets to two — below threshold, no alert.
    expect(assess(ok(10), { vanished: 5, appeared: 3 })).toEqual([]);
  });

  it("stays silent on a healthy run with a genuinely empty listing", () => {
    expect(assess(ok(0), { vanished: 0, appeared: 0 })).toEqual([]);
  });

  it("can raise both a rows-failed and a cohort-drop signal at once", () => {
    const failures: ParseFailure[] = [{ fragment: "<tr/>", expected: "a departure instant" }];
    expect(assess(ok(3, failures), { vanished: 4, appeared: 0 })).toEqual([
      { kind: "rows-failed", failures },
      { kind: "cohort-drop", vanished: 4, appeared: 0 },
    ]);
  });
});
