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

describe("the site payload", () => {
  it("splits by type, carrying both record types", () => {
    const payload = buildSitePayload([venueEvent()], [portCall()]);

    expect(payload.venueEvents).toHaveLength(1);
    expect(payload.portCalls).toHaveLength(1);
  });

  it("labels every entry with the source that produced it", () => {
    const payload = buildSitePayload([venueEvent()], [portCall()]);

    expect(payload.venueEvents[0]?.source).toBe("suntec");
    expect(payload.portCalls[0]?.source).toBe("scc");
  });

  it("keeps duplicates — two sources publishing one conference stay two entries", () => {
    // The everything-view merges nothing (ADR-0004). Two sources, same event,
    // must arrive as two labelled entries the client renders side by side.
    const payload = buildSitePayload(
      [
        venueEvent({ source: "suntec", uid: "a@x" }),
        venueEvent({ source: "other", uid: "b@x" }),
      ],
      [],
    );

    expect(payload.venueEvents.map((entry) => entry.source)).toEqual(["suntec", "other"]);
  });

  it("names a port call's vessel and shows its terminal", () => {
    const payload = buildSitePayload([], [portCall()]);
    const entry = payload.portCalls[0];

    expect(entry?.summary).toContain("ODYSSEY / VILLA VIE RESIDENCES");
    expect(entry?.summary).toContain("Singapore Cruise Centre");
    expect(entry?.location).toBe("Singapore Cruise Centre");
  });

  it("shows a venue event's hall where published, and omits it where not", () => {
    const withHall = buildSitePayload([venueEvent({ hall: "Level 4, Hall 404" })], []);
    expect(withHall.venueEvents[0]?.location).toBe("Suntec Convention Centre, Level 4, Hall 404");

    const withoutHall = buildSitePayload([venueEvent({ hall: null })], []);
    expect(withoutHall.venueEvents[0]?.location).toBe("Suntec Convention Centre");
  });

  it("carries timing as the stored instants, for the client to place on a grid", () => {
    const payload = buildSitePayload([venueEvent()], [portCall()]);

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
    const payload = buildSitePayload([venueEvent()], [portCall()]);
    const keys = Object.keys(payload.venueEvents[0] ?? {}).sort();

    expect(keys).toEqual(["end", "location", "source", "start", "summary", "uid"]);
  });
});
