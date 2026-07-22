// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import {
  assignLanes,
  entriesOnDay,
  filterEntries,
  monthGridCells,
  mountCalendar,
  normalizeEntries,
  sgtDayIndex,
  sgtDayKey,
  sgtMinutesOfDay,
  sgtMonthOf,
  weekDaysOf,
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
const switchView = (view: string) =>
  (root.querySelector(`[data-view="${view}"]`) as HTMLButtonElement).click();
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

  it("reads an instant's Singapore clock time, not the viewer's", () => {
    // 2026-07-18T20:00Z is 04:00 the next day in Singapore.
    expect(sgtMinutesOfDay(new Date("2026-07-18T20:00:00Z"))).toBe(4 * 60);
    expect(sgtMinutesOfDay(new Date("2026-07-18T02:30:00Z"))).toBe(10 * 60 + 30);
  });

  it("gives the Monday-first week that contains a day, whichever weekday it is", () => {
    // 21 Jul 2026 is a Tuesday; its week runs Mon 20 — Sun 26.
    const today = sgtDayIndex(new Date("2026-07-21T02:00:00Z"));
    const week = weekDaysOf(today, today);
    expect(week).toHaveLength(7);
    expect(week[0]).toMatchObject({ day: 20, month: 7 });
    expect(week[6]).toMatchObject({ day: 26, month: 7 });
    expect(week.find((d) => d.isToday)).toMatchObject({ day: 21 });
  });

  it("stacks only genuinely overlapping intervals into separate lanes", () => {
    // Two overlap → two lanes; the third starts after both end → back to lane 0.
    const spans = [
      { s: 0, e: 10 },
      { s: 5, e: 15 },
      { s: 20, e: 25 },
    ];
    const laid = assignLanes(spans, (x) => x.s, (x) => x.e);
    expect(laid.map((l) => l.lane)).toEqual([0, 1, 0]);
    expect(laid.every((l) => l.lanes === 2)).toBe(true);
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

describe("four switchable reading surfaces", () => {
  const parsePct = (value: string) => Number.parseFloat(value.replace("%", ""));

  it("offers all four views as tabs, any reachable from any other in one click", () => {
    mount(payloadOf());
    const tabs = Array.from(root.querySelectorAll("[data-view]")).map((n) =>
      (n as HTMLElement).dataset["view"],
    );
    expect(tabs).toEqual(["month", "week", "agenda", "spine"]);

    // From Month straight to Date-spine, then to Week — no intermediate step.
    switchView("spine");
    expect(root.querySelector(".spine")).not.toBeNull();
    switchView("week");
    expect(root.querySelector(".week")).not.toBeNull();
    expect(root.querySelector(".spine")).toBeNull();
  });

  it("Week positions a single-day entry by its true published clock time", () => {
    // A venue event 02:00–08:00Z is 10:00–16:00 Singapore.
    mount(
      payloadOf({
        venueEvents: [congress({ start: "2026-07-21T02:00:00Z", end: "2026-07-21T08:00:00Z" })],
        portCalls: [],
      }),
    );
    switchView("week");
    const col = root.querySelector('.week__col[data-day="2026-07-21"]');
    const event = col?.querySelector(".week__event") as HTMLElement;
    expect(event).not.toBeNull();
    // 10:00 of 24h ≈ 41.67% down; 6h tall ≈ 25%.
    expect(parsePct(event.style.top)).toBeCloseTo((10 / 24) * 100, 1);
    expect(parsePct(event.style.height)).toBeCloseTo((6 / 24) * 100, 1);
    expect(event.textContent).toContain("10:00–16:00");
  });

  it("Week rides a multi-day entry on the all-day band, not the hour grid", () => {
    mount(payloadOf({ portCalls: [] })); // congress spans 17–19 July
    switchView("week");
    click("prev"); // step back a week to the one holding 13–19 July
    const band = root.querySelector(".week__allday .week__band");
    expect(band?.textContent).toContain("Global MICE Congress");
    // It is a band, not a timed column entry.
    expect(root.querySelector(".week__event")).toBeNull();
  });

  it("Week splits two overlapping single-day entries into side-by-side lanes", () => {
    mount(
      payloadOf({
        venueEvents: [
          congress({ uid: "a@x", start: "2026-07-21T02:00:00Z", end: "2026-07-21T06:00:00Z" }),
          congress({ uid: "b@x", start: "2026-07-21T04:00:00Z", end: "2026-07-21T08:00:00Z" }),
        ],
        portCalls: [],
      }),
    );
    switchView("week");
    const events = Array.from(
      root.querySelectorAll('.week__col[data-day="2026-07-21"] .week__event'),
    ) as HTMLElement[];
    expect(events).toHaveLength(2);
    expect(events.map((e) => parsePct(e.style.width))).toEqual([50, 50]);
    expect(events.map((e) => parsePct(e.style.left)).sort((a, b) => a - b)).toEqual([0, 50]);
  });

  it("Agenda names every entry with its location and repeats a multi-day entry per day", () => {
    mount(payloadOf({ portCalls: [] })); // congress spans 17, 18, 19 July
    switchView("agenda");
    const days = Array.from(root.querySelectorAll(".agenda__day")).map((n) =>
      (n as HTMLElement).dataset["day"],
    );
    expect(days).toEqual(["2026-07-17", "2026-07-18", "2026-07-19"]);

    const day18 = root.querySelector('.agenda__day[data-day="2026-07-18"]');
    expect(day18?.querySelector(".calendar__entry-title")?.textContent).toBe("Global MICE Congress");
    expect(day18?.querySelector(".calendar__entry-where")?.textContent).toContain("Hall 404");
  });

  it("Date-spine renders duration as a proportional span — long dominates short", () => {
    mount(payloadOf()); // congress ~2.25 days, cruise ~0.33 day
    switchView("spine");
    const bars = Array.from(root.querySelectorAll(".spine__bar")) as HTMLElement[];
    const byType = (type: string) =>
      bars.find((b) => b.dataset["type"] === type) as HTMLElement;
    const congressH = parsePct(byType("VenueEvent").style.height);
    const cruiseH = parsePct(byType("PortCall").style.height);
    // The multi-day band is several times taller than the few-hour call — span
    // stands in for magnitude, across the data's wide duration range.
    expect(congressH).toBeGreaterThan(cruiseH * 3);
    expect(byType("VenueEvent").textContent).toContain("2.3 days");
  });

  it("applies the type filter once and keeps it across every view switch", () => {
    // Both entries sit on 22 July, inside every view's default window (the July
    // month and the 20–26 July week), so each view has something to filter.
    mount(
      payloadOf({
        venueEvents: [congress({ start: "2026-07-22T02:00:00Z", end: "2026-07-22T08:00:00Z" })],
        portCalls: [cruise({ start: "2026-07-22T00:00:00Z", end: "2026-07-22T08:00:00Z" })],
      }),
    );
    setFilter("PortCall");
    for (const view of ["week", "agenda", "spine", "month"]) {
      switchView(view);
      expect((root.querySelector(".calendar__filter") as HTMLSelectElement).value).toBe("PortCall");
      expect(root.querySelectorAll('.calendar__entry[data-type="VenueEvent"]').length).toBe(0);
      expect(root.querySelectorAll('.calendar__entry[data-type="PortCall"]').length).toBeGreaterThan(0);
    }
  });

  it("preserves navigation position when switching views", () => {
    mount(payloadOf());
    click("prev"); // Month: June 2026
    expect(title()).toBe("June 2026");
    switchView("week"); // the week is inside June, not July
    expect(title()).toMatch(/Jun 2026$/);
    switchView("agenda"); // back to a month window — still June
    expect(title()).toBe("June 2026");
  });

  it("pages Week by the week and returns home via Today from any view", () => {
    mount(payloadOf());
    switchView("week");
    const start = title();
    click("next");
    expect(title()).not.toBe(start);
    click("today");
    // Today's week contains 21 July 2026 (Mon 20 – Sun 26).
    expect(title()).toBe("20 – 26 Jul 2026");
  });

  it("introduces no magnitude in any view — no count, ranking or overflow", () => {
    const many = Array.from({ length: 5 }, (_, index) =>
      congress({ uid: `m${index}@x`, summary: `Fair ${index}`, source: `src${index}` }),
    );
    mount(payloadOf({ venueEvents: many, portCalls: [] }));
    for (const view of ["week", "agenda", "spine"]) {
      switchView(view);
      expect(root.textContent ?? "").not.toMatch(/\+\s*\d+\s*more/i);
    }
  });
});
