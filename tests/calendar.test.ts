// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  entriesOnDay,
  filterEntries,
  monthGridCells,
  mountCalendar,
  normalizeEntries,
  sgtDayKey,
  sgtMonthOf,
} from "../site/calendar.js";

/**
 * **Seam 3** (#38): the client layer, rendered against a real DOM (jsdom) with
 * the clock injected. Nothing here reaches the network or reads the wall clock —
 * `mountCalendar` takes both the document (via the root's owner) and `now` as
 * arguments, which is the property that makes the page testable at all.
 *
 * The dataset is deliberately adversarial in the small: a multi-day congress, a
 * cruise call, a past entry, and two sources publishing one conference — the
 * everything-view the page must carry unmerged.
 */

type Entry = {
  uid: string;
  summary: string;
  start: string;
  end: string;
  location: string;
  source: string;
};

type Payload = { venueEvents: Entry[]; portCalls: Entry[] };

// Instants are UTC; Singapore is +08:00, so these land squarely inside a
// Singapore July day well away from either midnight boundary.
const congress = (overrides: Partial<Entry> = {}): Entry => ({
  uid: "congress@x",
  summary: "Global MICE Congress",
  start: "2026-07-17T02:00:00Z",
  end: "2026-07-19T08:00:00Z",
  location: "Suntec Convention Centre, Level 4, Hall 404",
  source: "suntec",
  ...overrides,
});

const cruise = (overrides: Partial<Entry> = {}): Entry => ({
  uid: "cruise@x",
  summary: "Cruise: ODYSSEY / VILLA VIE RESIDENCES at Singapore Cruise Centre",
  start: "2026-07-18T00:00:00Z",
  end: "2026-07-18T08:00:00Z",
  location: "Singapore Cruise Centre",
  source: "scc",
  ...overrides,
});

const payloadOf = (overrides: Partial<Payload> = {}): Payload => ({
  venueEvents: [congress()],
  portCalls: [cruise()],
  ...overrides,
});

/** 21 July 2026, mid-morning Singapore — the frozen "now" the page lands on. */
const JULY_21 = new Date("2026-07-21T02:00:00Z");

let root: HTMLElement;

beforeEach(() => {
  root = document.createElement("div");
  document.body.appendChild(root);
});

const mount = (payload: Payload, now: Date = JULY_21) => mountCalendar(root, payload, now);

const title = () => root.querySelector(".calendar__title")?.textContent;
const cell = (day: string) => root.querySelector(`.calendar__day[data-day="${day}"]`);
const entriesIn = (day: string) =>
  Array.from(cell(day)?.querySelectorAll(".calendar__entry") ?? []);
const summariesIn = (day: string) =>
  entriesIn(day).map((node) => node.querySelector(".calendar__entry-title")?.textContent);
const click = (which: string) =>
  (root.querySelector(`[data-nav="${which}"]`) as HTMLButtonElement).click();
const setFilter = (value: string) => {
  const select = root.querySelector(".calendar__filter") as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change"));
};

describe("the model, in Singapore time", () => {
  it("buckets an instant into its Singapore calendar day, not the viewer's", () => {
    // 2026-07-18T20:00Z is already 2026-07-19 04:00 in Singapore.
    expect(sgtDayKey(new Date("2026-07-18T20:00:00Z"))).toBe(20260719);
    expect(sgtMonthOf(new Date("2026-07-31T20:00:00Z"))).toEqual({ year: 2026, month: 8 });
  });

  it("returns a multi-day entry for every day it spans", () => {
    const entries = normalizeEntries(payloadOf({ portCalls: [] }));
    expect(entriesOnDay(entries, 20260716)).toHaveLength(0);
    expect(entriesOnDay(entries, 20260717)).toHaveLength(1);
    expect(entriesOnDay(entries, 20260718)).toHaveLength(1);
    expect(entriesOnDay(entries, 20260719)).toHaveLength(1);
    expect(entriesOnDay(entries, 20260720)).toHaveLength(0);
  });

  it("defaults the filter to everything and narrows to one type on demand", () => {
    const entries = normalizeEntries(payloadOf());
    expect(filterEntries(entries, "all")).toHaveLength(2);
    expect(filterEntries(entries, "VenueEvent").map((e) => e.type)).toEqual(["VenueEvent"]);
    expect(filterEntries(entries, "PortCall").map((e) => e.type)).toEqual(["PortCall"]);
  });

  it("pads a month to whole Monday-first weeks", () => {
    // July 2026 starts on a Wednesday; a Monday-first grid leads with Mon 29 Jun.
    const cells = monthGridCells(2026, 7, 20260721);
    expect(cells.length % 7).toBe(0);
    expect(cells[0]).toMatchObject({ day: 29, month: 6, inMonth: false });
    expect(cells.find((c) => c.isToday)).toMatchObject({ day: 21, month: 7 });
  });
});

describe("the rendered page", () => {
  it("lands on today's month, in Singapore time, with no configuration", () => {
    mount(payloadOf());
    expect(title()).toBe("July 2026");
    expect(cell("2026-07-21")?.classList.contains("calendar__day--today")).toBe(true);
  });

  it("renders a multi-day entry on every day it spans, and nowhere else", () => {
    mount(payloadOf({ portCalls: [] }));
    expect(summariesIn("2026-07-16")).toEqual([]);
    expect(summariesIn("2026-07-17")).toEqual(["Global MICE Congress"]);
    expect(summariesIn("2026-07-18")).toEqual(["Global MICE Congress"]);
    expect(summariesIn("2026-07-19")).toEqual(["Global MICE Congress"]);
    expect(summariesIn("2026-07-20")).toEqual([]);
  });

  it("labels every entry with the source that produced it", () => {
    mount(payloadOf());
    const sources = Array.from(root.querySelectorAll(".calendar__source")).map((n) => n.textContent);
    expect(sources).toContain("suntec");
    expect(sources).toContain("scc");
  });

  it("renders two sources' duplicate as two labelled entries, merged by nothing", () => {
    mount(
      payloadOf({
        venueEvents: [
          congress({ uid: "a@x", source: "suntec", start: "2026-07-18T02:00:00Z", end: "2026-07-18T08:00:00Z" }),
          congress({ uid: "b@x", source: "otherlist", start: "2026-07-18T02:00:00Z", end: "2026-07-18T08:00:00Z" }),
        ],
        portCalls: [],
      }),
    );
    const entries = entriesIn("2026-07-18");
    expect(entries).toHaveLength(2);
    expect(entries.map((n) => n.querySelector(".calendar__source")?.textContent).sort()).toEqual([
      "otherlist",
      "suntec",
    ]);
  });

  it("names a port call's vessel and terminal, and a venue event's hall", () => {
    mount(payloadOf());
    const cruiseEntry = cell("2026-07-18")?.querySelector('.calendar__entry[data-type="PortCall"]');
    expect(cruiseEntry?.textContent).toContain("ODYSSEY / VILLA VIE RESIDENCES");
    expect(cruiseEntry?.textContent).toContain("Singapore Cruise Centre");

    const venueEntry = cell("2026-07-17")?.querySelector('.calendar__entry[data-type="VenueEvent"]');
    expect(venueEntry?.textContent).toContain("Level 4, Hall 404");
  });

  it("filters to one type and back, defaulting to All", () => {
    mount(payloadOf());
    expect(root.querySelectorAll('.calendar__entry[data-type="VenueEvent"]').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('.calendar__entry[data-type="PortCall"]').length).toBeGreaterThan(0);

    setFilter("PortCall");
    expect(root.querySelectorAll('.calendar__entry[data-type="VenueEvent"]').length).toBe(0);
    expect(root.querySelectorAll('.calendar__entry[data-type="PortCall"]').length).toBeGreaterThan(0);

    setFilter("all");
    expect(root.querySelectorAll('.calendar__entry[data-type="VenueEvent"]').length).toBeGreaterThan(0);
  });

  it("returns to the present from anywhere via the Today control", () => {
    mount(payloadOf());
    click("prev");
    click("prev");
    expect(title()).toBe("May 2026");
    click("today");
    expect(title()).toBe("July 2026");
  });

  it("reaches past entries by navigating backwards, but never lands there by default", () => {
    // Retention is unbounded and the past is reachable — but the default focus is
    // today, so a June entry is only ever one Prev away, never the landing.
    mount(
      payloadOf({
        venueEvents: [congress({ summary: "Past Expo", start: "2026-06-10T02:00:00Z", end: "2026-06-10T08:00:00Z" })],
        portCalls: [],
      }),
    );
    expect(title()).toBe("July 2026");
    expect(summariesIn("2026-06-10")).toEqual([]); // not on the July grid at all

    click("prev");
    expect(title()).toBe("June 2026");
    expect(summariesIn("2026-06-10")).toEqual(["Past Expo"]);
  });

  it("shows no magnitude — a busy day stacks every entry, with no count or overflow", () => {
    // #38 and ADR-0009 §5: no impact score, no density ranking, no `+N more`.
    const many = Array.from({ length: 5 }, (_, index) =>
      congress({
        uid: `m${index}@x`,
        summary: `Fair ${index}`,
        source: `src${index}`,
        start: "2026-07-15T02:00:00Z",
        end: "2026-07-15T08:00:00Z",
      }),
    );
    mount(payloadOf({ venueEvents: many, portCalls: [] }));
    expect(entriesIn("2026-07-15")).toHaveLength(5);
    expect(root.textContent ?? "").not.toMatch(/\+\s*\d+\s*more/i);
  });
});
