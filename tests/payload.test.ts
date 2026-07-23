import { describe, expect, it } from "vitest";
import { instant } from "../src/domain/instant.js";
import type { PortCall, VenueEvent } from "../src/domain/types.js";
import { buildSitePayload } from "../src/site/payload.js";

/**
 * The web calendar's data payload — the everything-view #38 rests on. It is the
 * one place the whole dataset leaves the pipeline for the client, so every
 * property the page needs has to survive this projection: both record types, all
 * sources, duplicates unmerged, each entry labelled by its source, and the
 * reader-facing facts (vessel, terminal, hall) legible in the rendered strings.
 *
 * It is a **serializer over the domain types**, not over `CalendarEntry` widened
 * — but it reuses the settled projection so the web calendar and the feeds tell
 * one story (CONTEXT.md § CalendarEntry names the web calendar a consumer).
 */

const venueEvent = (overrides: Partial<VenueEvent> = {}): VenueEvent => ({
  uid: "ve-1@sg-tourism-calendar",
  sequence: 0,
  source: "suntec",
  sourceKey: "bni-vision",
  name: "BNI Vision",
  start: instant("2026-07-17T04:00:00Z"),
  end: instant("2026-07-17T10:00:00Z"),
  venue: "Suntec Convention Centre",
  hall: "Level 4, Hall 404",
  firstSeenAt: instant("2026-07-01T02:00:00Z"),
  lastSeenAt: instant("2026-07-01T02:00:00Z"),
  ...overrides,
});

const portCall = (overrides: Partial<PortCall> = {}): PortCall => ({
  uid: "pc-1@sg-tourism-calendar",
  sequence: 0,
  source: "scc",
  sourceKey: "ODYSSEY|2026-07-18",
  vessel: "ODYSSEY / VILLA VIE RESIDENCES",
  terminal: "Singapore Cruise Centre",
  berth: "Pier 2",
  arrival: instant("2026-07-18T00:00:00Z"),
  departure: instant("2026-07-18T10:00:00Z"),
  firstSeenAt: instant("2026-07-01T02:00:00Z"),
  lastSeenAt: instant("2026-07-01T02:00:00Z"),
  ...overrides,
});

/**
 * The run instant, defaulted so a case that is not about publishing does not
 * have to name one. Only § the publish instant reads it back.
 */
const RAN_AT = instant("2026-07-23T02:05:17Z");

const build = (
  venueEvents: VenueEvent[],
  portCalls: PortCall[],
  generatedAt = RAN_AT,
) => buildSitePayload(venueEvents, portCalls, generatedAt);

describe("the site payload", () => {
  it("splits by type, carrying both record types", () => {
    const payload = build([venueEvent()], [portCall()]);

    expect(payload.venueEvents).toHaveLength(1);
    expect(payload.portCalls).toHaveLength(1);
  });

  it("labels every entry with the source that produced it", () => {
    const payload = build([venueEvent()], [portCall()]);

    expect(payload.venueEvents[0]?.source).toBe("suntec");
    expect(payload.portCalls[0]?.source).toBe("scc");
  });

  it("keeps duplicates — two sources publishing one conference stay two entries", () => {
    // The everything-view merges nothing (ADR-0004). Two sources, same event,
    // must arrive as two labelled entries the client renders side by side.
    const payload = build(
      [
        venueEvent({ source: "suntec", uid: "a@x" }),
        venueEvent({ source: "other", uid: "b@x" }),
      ],
      [],
    );

    expect(payload.venueEvents.map((entry) => entry.source)).toEqual(["suntec", "other"]);
  });

  it("names a port call's vessel and shows its terminal", () => {
    const payload = build([], [portCall()]);
    const entry = payload.portCalls[0];

    expect(entry?.summary).toContain("ODYSSEY / VILLA VIE RESIDENCES");
    expect(entry?.summary).toContain("Singapore Cruise Centre");
    expect(entry?.location).toBe("Singapore Cruise Centre");
  });

  it("shows a venue event's hall where published, and omits it where not", () => {
    const withHall = build([venueEvent({ hall: "Level 4, Hall 404" })], []);
    expect(withHall.venueEvents[0]?.location).toBe("Suntec Convention Centre, Level 4, Hall 404");

    const withoutHall = build([venueEvent({ hall: null })], []);
    expect(withoutHall.venueEvents[0]?.location).toBe("Suntec Convention Centre");
  });

  it("carries timing as the stored instants, for the client to place on a grid", () => {
    const payload = build([venueEvent()], [portCall()]);

    expect(payload.venueEvents[0]?.start).toBe("2026-07-17T04:00:00Z");
    expect(payload.venueEvents[0]?.end).toBe("2026-07-17T10:00:00Z");
    expect(payload.portCalls[0]?.start).toBe("2026-07-18T00:00:00Z");
    expect(payload.portCalls[0]?.end).toBe("2026-07-18T10:00:00Z");
  });

  it("carries no magnitude, score, or density field anywhere", () => {
    // #38 and ADR-0009 §5: the sources publish no attendance or passenger count,
    // and none is invented. A payload that grew such a field is where the banned
    // ranking would first re-enter, so the shape is asserted to be exactly the
    // reader-facing facts and nothing more.
    const payload = build([venueEvent()], [portCall()]);
    const keys = Object.keys(payload.venueEvents[0] ?? {}).sort();

    expect(keys).toEqual(["end", "location", "source", "start", "summary", "uid"]);
  });
});

describe("the publish instant (#61)", () => {
  it("bakes the run instant, so the published artifact states its own age", () => {
    // The freshness alarm (ADR-0013) reads this and nothing else. It is the run
    // instant — a property of the *publish*, not of any source — which is what
    // makes it the honest measure of CONTEXT.md § Freshness.
    const payload = build([venueEvent()], [portCall()], instant("2026-07-23T02:05:17Z"));

    expect(payload.generatedAt).toBe("2026-07-23T02:05:17Z");
  });

  it("advances even when every source is unreadable and nothing was upserted", () => {
    // The trap this field exists to avoid: `sources[].lastConfirmed` freezes when
    // a scraper breaks, so an alarm reading it would fire on a calendar that was
    // published perfectly on time. Freshness and Source health are orthogonal in
    // both directions (CONTEXT.md), and only this field respects that — it is
    // present and current on a run that confirmed no source at all.
    const payload = build([], [], instant("2026-07-23T02:05:17Z"));

    expect(payload.generatedAt).toBe("2026-07-23T02:05:17Z");
    expect(payload.sources).toEqual([]);
  });
});

describe("per-source freshness (#40)", () => {
  it("bakes one last-confirmed instant per source, machine-readable", () => {
    // The page computes 'X ago' from this; the build only bakes the instant.
    const payload = build(
      [venueEvent({ source: "suntec", lastSeenAt: instant("2026-07-20T20:51:02Z") })],
      [portCall({ source: "scc", lastSeenAt: instant("2026-07-20T20:51:02Z") })],
    );

    expect(payload.sources).toEqual([
      { source: "scc", lastConfirmed: "2026-07-20T20:51:02Z" },
      { source: "suntec", lastConfirmed: "2026-07-20T20:51:02Z" },
    ]);
  });

  it("takes the source's MAX lastSeenAt — the source's liveness, not a record's", () => {
    // A source stays healthy while individual records drop: the dropped record's
    // lastSeenAt freezes, but another record confirms the source is still live.
    // Freshness is the source's most recent confirmation (max), never a single
    // record's — ADR-0004 forbids the per-record cancellation judgment.
    const payload = build(
      [
        venueEvent({ uid: "stale@x", sourceKey: "a", lastSeenAt: instant("2026-07-20T05:54:48Z") }),
        venueEvent({ uid: "live@x", sourceKey: "b", lastSeenAt: instant("2026-07-20T20:51:02Z") }),
      ],
      [],
    );

    expect(payload.sources).toEqual([
      { source: "suntec", lastConfirmed: "2026-07-20T20:51:02Z" },
    ]);
  });

  it("orders sources deterministically, so the committed payload diff stays stable", () => {
    const payload = build(
      [
        venueEvent({ source: "suntec", uid: "s@x" }),
        venueEvent({ source: "mbccs", uid: "m@x" }),
      ],
      [portCall({ source: "scc", uid: "c@x" })],
    );

    expect(payload.sources.map((entry) => entry.source)).toEqual(["mbccs", "scc", "suntec"]);
  });

  it("lists a source once even when it spans both record types", () => {
    // A source is not guaranteed to publish one type; if one ever published both,
    // its freshness is still one line, maxed across every record it owns.
    const payload = build(
      [venueEvent({ source: "dual", uid: "v@x", lastSeenAt: instant("2026-07-19T00:00:00Z") })],
      [portCall({ source: "dual", uid: "p@x", lastSeenAt: instant("2026-07-21T00:00:00Z") })],
    );

    expect(payload.sources).toEqual([
      { source: "dual", lastConfirmed: "2026-07-21T00:00:00Z" },
    ]);
  });

  it("is empty when there is nothing to attribute", () => {
    expect(build([], []).sources).toEqual([]);
  });
});
