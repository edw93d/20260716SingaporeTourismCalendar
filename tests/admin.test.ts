import { describe, expect, it } from "vitest";
import { instant } from "../src/domain/instant.js";
import type { SourceId, VenueEvent } from "../src/domain/types.js";
import { renderAdminPage } from "../src/server/admin.js";

/**
 * **The admin spreadsheet's rendering — a pure function** (#155). The moderator
 * page is server-rendered from the store's `VenueEvent[]`; factoring the markup
 * out of the request handler lets the column set, the SGT time surfacing, the
 * missing-time rule and the HTML-escaping be pinned here as documentation of the
 * decision each guards, without a socket. The auth boundary that fronts this
 * page is proven separately, at the server seam (`tests/server.test.ts`).
 */

const suntecEvent = (over: Partial<VenueEvent> = {}): VenueEvent => ({
  uid: "uid-ve-1@sg-tourism-calendar",
  sequence: 0,
  source: "suntec",
  sourceKey: "bni-vision1472026",
  name: "BNI Vision",
  // 04:00Z is 12:00 in Singapore (+08:00) — a real, surfaced time.
  start: instant("2026-07-17T04:00:00Z"),
  end: instant("2026-07-17T10:00:00Z"),
  venue: "Suntec Convention Centre",
  hall: "Level 4, Hall 404",
  hidden: false,
  reviewed: false,
  firstSeenAt: instant("2026-07-01T02:00:00Z"),
  lastSeenAt: instant("2026-07-01T02:00:00Z"),
  ...over,
});

/** The registry's admin-facing descriptions, faked so the test owns the text. */
const describe_ = (descriptions: Record<string, string>) => (source: SourceId) =>
  descriptions[source];

const noDescriptions = () => undefined;

describe("the admin spreadsheet columns", () => {
  it("carries the seven column headers in order", () => {
    const html = renderAdminPage([], noDescriptions);
    const headers = [
      "Source",
      "Event",
      "Venue",
      "Start (SGT)",
      "End (SGT)",
      "Review state",
      "Shown on calendar",
    ];
    // Each header appears, in the ticket's order.
    let cursor = 0;
    for (const header of headers) {
      const at = html.indexOf(header, cursor);
      expect(at, `header ${header} out of order or missing`).toBeGreaterThan(-1);
      cursor = at + header.length;
    }
  });

  it("renders one row per VenueEvent", () => {
    const html = renderAdminPage(
      [suntecEvent({ uid: "a", name: "BNI Vision" }), suntecEvent({ uid: "b", name: "Cellar Fiesta" })],
      noDescriptions,
    );
    expect(html).toContain("BNI Vision");
    expect(html).toContain("Cellar Fiesta");
    expect((html.match(/<tr[ >]/g) ?? []).length).toBe(3); // header row + two records
  });
});

describe("Start and End are date and time in Singapore", () => {
  it("shows the SGT wall-clock time, not the stored UTC", () => {
    const html = renderAdminPage([suntecEvent()], noDescriptions);
    // 04:00Z → 12:00 SGT; 10:00Z → 18:00 SGT. The date is the SGT calendar date.
    expect(html).toContain("17 Jul 2026, 12:00");
    expect(html).toContain("17 Jul 2026, 18:00");
    // The raw UTC time must not leak into the cell.
    expect(html).not.toContain("04:00");
  });

  it("renders a genuinely-missing time as an em dash, never 00:00", () => {
    // 16:00Z is 00:00 the next day in Singapore — the shape a date-only source
    // would land as, since the model has no all-day instant (ADR-0003). The
    // moderator must see absence, not a faked midnight.
    const midnightSgt = suntecEvent({ start: instant("2026-07-16T16:00:00Z") });
    const html = renderAdminPage([midnightSgt], noDescriptions);
    expect(html).toContain("17 Jul 2026, —");
    expect(html).not.toContain("00:00");
  });
});

describe("the source cell", () => {
  it("shows the bare source key with its admin-facing description on hover", () => {
    const html = renderAdminPage(
      [suntecEvent()],
      describe_({ suntec: "Suntec Singapore — the venue's own listing (first-hand)." }),
    );
    expect(html).toContain(
      'title="Suntec Singapore — the venue&#39;s own listing (first-hand)."',
    );
    expect(html).toContain(">suntec<");
  });

  it("omits the hover when a source has no manifest description", () => {
    const html = renderAdminPage([suntecEvent({ source: "manual" })], noDescriptions);
    expect(html).toContain("manual");
    expect(html).not.toContain("title=");
  });
});

describe("the admin read shows everything, including what the public cannot see", () => {
  it("renders hidden and unreviewed rows with their state", () => {
    const html = renderAdminPage(
      [
        suntecEvent({ uid: "a", name: "Kept", hidden: false, reviewed: true }),
        suntecEvent({ uid: "b", name: "Cleaned away", hidden: true, reviewed: false }),
      ],
      noDescriptions,
    );
    expect(html).toContain("Reviewed");
    expect(html).toContain("Unreviewed");
    expect(html).toContain("Hidden");
    expect(html).toContain("Shown");
    // A hidden record is present in the admin read — the boundary is auth, not omission.
    expect(html).toContain("Cleaned away");
  });
});

describe("safety", () => {
  it("HTML-escapes record text so a listing name cannot inject markup", () => {
    const html = renderAdminPage(
      [suntecEvent({ name: '<script>alert("x")</script>', venue: "A & B <hall>" })],
      noDescriptions,
    );
    expect(html).not.toContain("<script>alert");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("A &amp; B &lt;hall&gt;");
  });
});
