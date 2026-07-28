// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  WEEK_BAND_LANES,
  assignLanes,
  entriesOnDay,
  filterEntries,
  freshness,
  monthGridCells,
  mountCalendar,
  normalizeEntries,
  packAllDayBand,
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

type Freshness = { source: string; lastConfirmed: string };
type Payload = { venueEvents: Entry[]; portCalls: Entry[]; sources?: Freshness[] };

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

/** The grid's Monday-first column headers, in order. */
const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** 21 July 2026, mid-morning Singapore — the frozen "now" the page lands on. */
const JULY_21 = new Date("2026-07-21T02:00:00Z");

let root: HTMLElement;
let topbar: HTMLElement;

/**
 * The page shell `site/index.html` supplies: a pinned `<header class="topbar">`
 * holding the static h1, into which the controls render (#73), and the mount
 * root below it holding the scrolling surface. The tests build the same shell so
 * the DOM under test is the DOM the page ships.
 */
beforeEach(() => {
  document.body.textContent = "";
  document.documentElement.removeAttribute("style");
  topbar = document.createElement("header");
  topbar.className = "topbar";
  topbar.appendChild(document.createElement("h1"));
  root = document.createElement("div");
  document.body.append(topbar, root);
});

const mount = (payload: Payload, now: Date = JULY_21) =>
  mountCalendar(root, payload, now, { topbar });

/** Controls live in the topbar, the surface in the root — query the page. */
const find = (selector: string) => document.body.querySelector(selector);
const title = () => find(".calendar__title")?.textContent;
const cell = (day: string) => root.querySelector(`.calendar__day[data-day="${day}"]`);
/**
 * Month renders **chips**, not entries (#80): one line each, capped per day, the
 * overflow collapsed behind a `+N more`. The reading surfaces render the full
 * `.calendar__entry`; only Month has chips, so these two helpers are what tell a
 * Month assertion from a reading-surface one.
 */
const chipsIn = (day: string) => Array.from(cell(day)?.querySelectorAll(".calendar__chip") ?? []);
const summariesIn = (day: string) => chipsIn(day).map((node) => node.textContent);
const moreIn = (day: string) => cell(day)?.querySelector(".calendar__more") as HTMLButtonElement | null;
/** The entries Agenda draws for a day — the surface a chip's overflow drills to. */
const agendaEntriesOn = (day: string) =>
  Array.from(root.querySelectorAll(`.agenda__day[data-day="${day}"] .calendar__entry`));
const click = (which: string) => (find(`[data-nav="${which}"]`) as HTMLButtonElement).click();
const switchView = (view: string) => (find(`[data-view="${view}"]`) as HTMLButtonElement).click();
const setFilter = (value: string) => {
  const select = find(".calendar__filter") as HTMLSelectElement;
  select.value = value;
  select.dispatchEvent(new Event("change"));
};

/**
 * jsdom has no layout, so `scrollIntoView` does not exist on it at all — the
 * page's own guard is what keeps the call safe there. Stubbing it is how much of
 * the behaviour jsdom can expose: not that the viewport moved, but that the page
 * asked the **right element** to come to the top of it. Called from a `describe`
 * body; it installs its own hooks and hands back the record.
 */
const trackScrollTargets = () => {
  const scrolled: Element[] = [];

  beforeEach(() => {
    scrolled.length = 0;
    (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView =
      function scrollIntoView(this: Element) {
        scrolled.push(this);
      };
  });

  afterEach(() => {
    delete (Element.prototype as unknown as { scrollIntoView?: () => void }).scrollIntoView;
  });

  return {
    scrolled,
    /** The `data-day` of the element the page last brought to the top. */
    landedOn: () => (scrolled.at(-1) as HTMLElement | undefined)?.dataset["day"],
  };
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

  it("keeps two all-day entries that touch on one day out of the same lane (#81)", () => {
    // The packer is half-open (the test above), but an all-day range is
    // **inclusive** of its end day: 10–12 and 12–14 both occupy day 12, so a
    // half-open read of `endIndex` would stack them in one lane and draw them
    // overlapping. The band packs against `endIndex + 1` instead — the fix lives
    // in this caller's derivation, not in `assignLanes`'s contract.
    const { shown } = packAllDayBand([
      { startIndex: 10, endIndex: 12 },
      { startIndex: 12, endIndex: 14 },
      // Starting the day after 14 ends, this one is genuinely clear of both.
      { startIndex: 15, endIndex: 16 },
    ]);
    expect(shown.map((s) => s.lane)).toEqual([0, 1, 0]);
  });

  it("reserves the band's lanes whatever the week holds, collapsing the rest (#81)", () => {
    // Four mutually overlapping entries fill the reserved lanes exactly — the
    // reservation is not a truncation, so nothing is hidden.
    const four = Array.from({ length: 4 }, (_, i) => ({ startIndex: 10, endIndex: 14, id: i }));
    expect(packAllDayBand(four).shown).toHaveLength(4);
    expect(packAllDayBand(four).hidden).toEqual([]);

    // A fifth needs a fifth lane, so the last reserved lane is spent on the
    // overflow door instead: three show, two collapse. The band's height is the
    // same either way.
    const five = Array.from({ length: 5 }, (_, i) => ({ startIndex: 10, endIndex: 14, id: i }));
    const { shown, hidden } = packAllDayBand(five);
    expect(shown.map((s) => s.item.id)).toEqual([0, 1, 2]);
    expect(hidden.map((h) => h.id)).toEqual([3, 4]);
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
    // Today is marked by the red disc on its date number, not a cell class.
    expect(cell("2026-07-21")?.querySelector(".disc")?.textContent).toBe("21");
  });

  it("marks today with the red disc on the date number in every view, tinting no cell", () => {
    // Give today (21 July) an entry so the Agenda actually renders its row.
    const onToday = congress({
      uid: "today@x",
      summary: "Today Event",
      start: "2026-07-21T02:00:00Z",
      end: "2026-07-21T06:00:00Z",
    });
    mount(payloadOf({ venueEvents: [congress(), onToday] }));

    // Month: the day number is the disc; a non-today day number is not.
    expect(cell("2026-07-21")?.querySelector(".disc")?.textContent).toBe("21");
    expect(cell("2026-07-20")?.querySelector(".disc")).toBeNull();

    // Week: the header carries the small disc variant on today.
    switchView("week");
    const weekToday = root.querySelector('.week__day[data-day="2026-07-21"]');
    expect(weekToday?.querySelector(".disc.disc--sm")?.textContent).toBe("21");

    // Agenda: the disc sits on the date number, beside the untouched weekday/month.
    switchView("agenda");
    const agendaToday = root.querySelector('.agenda__day[data-day="2026-07-21"]');
    expect(agendaToday?.querySelector(".agenda__date .disc")?.textContent).toBe("21");

    // Date-spine: the axis row for today carries the small disc.
    switchView("spine");
    const spineToday = root.querySelector('.spine__date[data-day="2026-07-21"]');
    expect(spineToday?.querySelector(".disc.disc--sm")?.textContent).toBe("21");

    // No view tints a whole cell, column, or row because today falls in it —
    // every legacy "today" emphasis class is gone from every view.
    for (const view of ["month", "week", "agenda", "spine"]) {
      switchView(view);
      expect(
        root.querySelector(
          ".calendar__day--today, .week__day--today, .week__col--today," +
            " .agenda__day--today, .spine__date--today",
        ),
      ).toBeNull();
    }
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
    // On the reading surfaces, where an entry renders in full. Month's chips are
    // one line (#80) and have no room for the label — the drill-through to
    // Agenda is what carries a Month reader to the attribution.
    mount(payloadOf());
    switchView("agenda");
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
    // Two chips on the day in Month — the duplicate is not merged into one — and
    // both sources still named on the reading surface the chips drill to.
    expect(chipsIn("2026-07-18")).toHaveLength(2);
    switchView("agenda");
    const entries = agendaEntriesOn("2026-07-18");
    expect(entries).toHaveLength(2);
    expect(entries.map((n) => n.querySelector(".calendar__source")?.textContent).sort()).toEqual([
      "otherlist",
      "suntec",
    ]);
  });

  it("names a port call's vessel and terminal, and a venue event's hall", () => {
    mount(payloadOf());
    // The Month chip is one line, so it carries the summary and hands the rest to
    // its tooltip; the reading surfaces print the location as its own line.
    const cruiseChip = cell("2026-07-18")?.querySelector('.calendar__chip[data-type="PortCall"]');
    // The `Cruise: ` prefix is dropped: on a chip this narrow it is eight
    // characters of constant crowding out the vessel, and the colour already
    // says what type it is. The full summary is still on the tooltip.
    expect(cruiseChip?.textContent).toBe("ODYSSEY / VILLA VIE RESIDENCES at Singapore Cruise Centre");
    expect(cruiseChip?.getAttribute("title")).toContain("Cruise: ODYSSEY / VILLA VIE RESIDENCES");
    expect(cruiseChip?.getAttribute("title")).toContain("Singapore Cruise Centre");

    const venueChip = cell("2026-07-17")?.querySelector('.calendar__chip[data-type="VenueEvent"]');
    expect(venueChip?.getAttribute("title")).toContain("Level 4, Hall 404");
  });

  it("filters to one type and back, defaulting to All", () => {
    mount(payloadOf());
    expect(root.querySelectorAll('.calendar__chip[data-type="VenueEvent"]').length).toBeGreaterThan(0);
    expect(root.querySelectorAll('.calendar__chip[data-type="PortCall"]').length).toBeGreaterThan(0);

    setFilter("PortCall");
    expect(root.querySelectorAll('.calendar__chip[data-type="VenueEvent"]').length).toBe(0);
    expect(root.querySelectorAll('.calendar__chip[data-type="PortCall"]').length).toBeGreaterThan(0);

    setFilter("all");
    expect(root.querySelectorAll('.calendar__chip[data-type="VenueEvent"]').length).toBeGreaterThan(0);
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

  it("shows no magnitude — a busy day is a stack of chips, never a count or a rank", () => {
    // #38 and ADR-0009 §5: no impact score, no density ranking. The `+N more`
    // past the cap (#80) is an overflow **door**, not a magnitude reading — it
    // only ever appears once a day exceeds the cap, and it names a destination.
    // Exactly at the cap, which is where a count would first be tempting.
    const many = Array.from({ length: 4 }, (_, index) =>
      congress({
        uid: `m${index}@x`,
        summary: `Fair ${index}`,
        source: `src${index}`,
        start: "2026-07-15T02:00:00Z",
        end: "2026-07-15T08:00:00Z",
      }),
    );
    mount(payloadOf({ venueEvents: many, portCalls: [] }));
    expect(chipsIn("2026-07-15")).toHaveLength(4);
    expect(root.textContent ?? "").not.toMatch(/\+\s*\d+\s*more/i);
  });
});

describe("Month: capped one-line chips, overflow to Agenda (#80)", () => {
  const { landedOn } = trackScrollTargets();

  /** `count` entries all landing on 15 July 2026, inside the default month. */
  const busyDay = (count: number) =>
    payloadOf({
      venueEvents: Array.from({ length: count }, (_, index) =>
        congress({
          uid: `m${index}@x`,
          summary: `Fair ${index}`,
          source: `src${index}`,
          start: "2026-07-15T02:00:00Z",
          end: "2026-07-15T08:00:00Z",
        }),
      ),
      portCalls: [],
    });

  it("renders a chip as one line: the summary, and nothing stacked under it", () => {
    mount(payloadOf({ portCalls: [] }));
    const [chip] = chipsIn("2026-07-17");
    expect(chip?.textContent).toBe("Global MICE Congress");
    // No entry sub-structure: a chip is a leaf, which is what keeps it one line.
    expect(chip?.querySelector(".calendar__entry-where, .calendar__source")).toBeNull();
    expect(cell("2026-07-17")?.querySelector(".calendar__entry")).toBeNull();
  });

  it("shows four chips when four is all there is — the cap is not a truncation", () => {
    mount(busyDay(4));
    expect(summariesIn("2026-07-15")).toEqual(["Fair 0", "Fair 1", "Fair 2", "Fair 3"]);
    expect(moreIn("2026-07-15")).toBeNull();
  });

  it("spends the fourth row on `+N more` once there is overflow, never a fifth row", () => {
    mount(busyDay(6));
    // Three chips, not four: the control costs the slot it occupies, so the cell
    // stays exactly as tall as a four-chip day.
    expect(summariesIn("2026-07-15")).toEqual(["Fair 0", "Fair 1", "Fair 2"]);
    expect(moreIn("2026-07-15")?.textContent).toMatch(/\+3 more/);
  });

  it("counts the overflow against the three chips actually shown", () => {
    mount(busyDay(5));
    expect(chipsIn("2026-07-15")).toHaveLength(3);
    expect(moreIn("2026-07-15")?.textContent).toMatch(/\+2 more/);
  });

  it("hands `+N more` to Agenda on that day, rather than dead-ending in a count", () => {
    mount(busyDay(6));
    moreIn("2026-07-15")?.click();
    // Agenda is showing, anchored on the day that overflowed — and every entry
    // the cap hid is there in full.
    expect(root.querySelector(".agenda")).not.toBeNull();
    expect(root.querySelector(".calendar__grid")).toBeNull();
    expect(agendaEntriesOn("2026-07-15")).toHaveLength(6);
    expect(root.querySelector('.agenda__day[data-day="2026-07-15"]')?.textContent).toContain("Fair 5");
    // And the day is brought to the top of the viewport, not left mid-surface.
    expect(landedOn()).toBe("2026-07-15");
  });

  it("steps Agenda from the drilled-to day, not from the month it was reached in", () => {
    // The drill seeds Agenda's entry-day cursor (#77), so the next step moves off
    // the overflowed day — the reader carries on from where they landed.
    mount(
      payloadOf({
        venueEvents: [
          ...Array.from({ length: 6 }, (_, index) =>
            congress({
              uid: `m${index}@x`,
              summary: `Fair ${index}`,
              start: "2026-07-15T02:00:00Z",
              end: "2026-07-15T08:00:00Z",
            }),
          ),
          congress({ uid: "later@x", summary: "Later Expo", start: "2026-07-23T02:00:00Z", end: "2026-07-23T08:00:00Z" }),
        ],
        portCalls: [],
      }),
    );
    moreIn("2026-07-15")?.click();
    click("next");
    expect(landedOn()).toBe("2026-07-23");
  });
});

describe("Month: the weekend wash and the month-boundary label (#72)", () => {
  // The stylesheet is read as text: the wash, the recede and the absence of a
  // positional rule are CSS facts, and jsdom applies no stylesheet at all.
  const shell = readFileSync("site/index.html", "utf8");
  /**
   * Every CSS declaration block whose selector counts positions in the grid.
   * Comments are stripped first — they discuss `nth-child` at length, and a
   * comment is not a rule.
   */
  const nthChildRules = () =>
    Array.from(shell.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]*nth-child[^{}]*)\{([^}]*)\}/g), (m) => ({
      selector: m[1]?.trim() ?? "",
      body: m[2] ?? "",
    }));
  const weekdayHeaders = () => Array.from(root.querySelectorAll(".calendar__weekday"));
  const weekend = (node: Element | null | undefined) =>
    node?.classList.contains("is-weekend") ?? false;

  it("washes the Saturday and Sunday cells and their column headers", () => {
    mount(payloadOf());
    // 25 and 26 July 2026 are the Saturday and Sunday of today's week.
    expect(weekend(cell("2026-07-25"))).toBe(true);
    expect(weekend(cell("2026-07-26"))).toBe(true);
    expect(weekend(cell("2026-07-24"))).toBe(false); // Friday
    expect(weekend(cell("2026-07-27"))).toBe(false); // Monday

    const headers = weekdayHeaders();
    expect(headers.map((h) => h.textContent)).toEqual(WEEKDAY_LABELS);
    expect(headers.filter(weekend).map((h) => h.textContent)).toEqual(["Sat", "Sun"]);
  });

  it("says weekend with a class, never by counting positions in the grid", () => {
    // Production bug 2: an `nth-child` wash drifts the moment any leading child
    // is added to the grid. The wash names the property it means — the day is a
    // weekend — so it cannot drift.
    // Both halves of the wash — the cells and the column headers above them.
    expect(shell).toMatch(
      /\.calendar__weekday\.is-weekend,\s*\.calendar__day\.is-weekend\s*\{[^}]*background/,
    );
    const painting = nthChildRules().filter((rule) => /background/.test(rule.body));
    expect(painting.map((rule) => rule.selector)).toEqual([]);
  });

  it("runs the wash unbroken through an outside-month day, which has none of its own", () => {
    mount(payloadOf());
    // July 2026's grid trails into Sat 1 and Sun 2 August: outside the month, and
    // still the weekend column, so the wash passes straight through them.
    const trailing = cell("2026-08-01");
    expect(trailing?.classList.contains("calendar__day--outside")).toBe(true);
    expect(weekend(trailing)).toBe(true);

    // The outside day paints no wash of its own — grey means exactly one thing in
    // this grid — and recedes by dropping its own contents to ~25% opacity.
    expect(shell).not.toMatch(/\.calendar__day--outside\s*\{[^}]*background/);
    expect(shell).toMatch(/\.calendar__day--outside\s*>\s*\*\s*\{[^}]*opacity:\s*0\.25/);
  });

  it("prints the month name beside the numeral on the 1st, inside the month and outside it", () => {
    mount(payloadOf());
    expect(cell("2026-07-01")?.querySelector(".calendar__monthname")?.textContent).toBe("Jul");
    expect(cell("2026-08-01")?.querySelector(".calendar__monthname")?.textContent).toBe("Aug");
    // Only the 1st announces its month; every other day is just its numeral.
    expect(cell("2026-07-21")?.querySelector(".calendar__monthname")).toBeNull();
    expect(cell("2026-06-29")?.querySelector(".calendar__monthname")).toBeNull();
  });

  it("carries the weekend on the model's cell, so the grid never has to count", () => {
    const cells = monthGridCells(2026, 7, 20260721);
    expect(cells.find((c) => c.day === 25 && c.month === 7)?.isWeekend).toBe(true);
    expect(cells.find((c) => c.day === 26 && c.month === 7)?.isWeekend).toBe(true);
    expect(cells.find((c) => c.day === 24 && c.month === 7)?.isWeekend).toBe(false);
    // The trailing outside days are weekends too — the property is the day's.
    expect(cells.find((c) => c.day === 1 && c.month === 8)).toMatchObject({
      inMonth: false,
      isWeekend: true,
    });
  });
});

describe("four switchable reading surfaces", () => {
  const parsePct = (value: string) => Number.parseFloat(value.replace("%", ""));

  it("offers all four views as tabs, any reachable from any other in one click", () => {
    mount(payloadOf());
    const tabs = Array.from(document.body.querySelectorAll("[data-view]")).map((n) =>
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
      expect((find(".calendar__filter") as HTMLSelectElement).value).toBe("PortCall");
      // Month draws chips, the reading surfaces draw entries — the filter is one
      // rule over both, so the assertion has to cover whichever the view renders.
      const shown = (type: string) =>
        root.querySelectorAll(`.calendar__entry[data-type="${type}"], .calendar__chip[data-type="${type}"]`).length;
      expect(shown("VenueEvent")).toBe(0);
      expect(shown("PortCall")).toBeGreaterThan(0);
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
    // The two `+N more` doors (#80's cell, #81's all-day band) are overflow, not
    // magnitude: neither appears until its surface runs out of room, and this
    // week has room. Nothing anywhere counts or ranks a day against its
    // neighbours.
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

describe("Week: the all-day band — inclusive ends, reserved lanes, overflow (#81)", () => {
  const { landedOn } = trackScrollTargets();

  const bands = () =>
    Array.from(root.querySelectorAll(".week__band:not(.week__band--more)")) as HTMLElement[];
  const bandMore = () => root.querySelector(".week__band--more") as HTMLButtonElement | null;
  /** The reserved rows the band publishes for its CSS to lay out against. */
  const reservedLanes = () =>
    (root.querySelector(".week__band-grid") as HTMLElement | null)?.style.getPropertyValue(
      "--band-lanes",
    );

  /** `count` all-day entries spanning Tue 21 — Thu 23 July, inside today's week. */
  const overlapping = (count: number) =>
    payloadOf({
      venueEvents: Array.from({ length: count }, (_, index) =>
        congress({
          uid: `m${index}@x`,
          summary: `Fair ${index}`,
          source: `src${index}`,
          start: "2026-07-21T02:00:00Z",
          end: "2026-07-23T08:00:00Z",
        }),
      ),
      portCalls: [],
    });

  it("keeps an entry ending on a day and one starting on it in separate lanes", () => {
    // 20–22 July and 22–24 July both occupy Wednesday the 22nd, so drawing them
    // in one lane would overlap them on that column.
    mount(
      payloadOf({
        venueEvents: [
          congress({ uid: "a@x", summary: "Ends Wed", start: "2026-07-20T02:00:00Z", end: "2026-07-22T08:00:00Z" }),
          congress({ uid: "b@x", summary: "Starts Wed", start: "2026-07-22T02:00:00Z", end: "2026-07-24T08:00:00Z" }),
        ],
        portCalls: [],
      }),
    );
    switchView("week");
    expect(bands().map((b) => b.style.gridRow)).toEqual(["1", "2"]);
  });

  it("puts an entry that clears the previous one's last day back in lane 1", () => {
    // 20–21 July then 22–24: the second starts the day *after* the first ends,
    // so they share no day and the packer reuses the lane. The inclusive-end fix
    // must not simply push everything into a lane of its own.
    mount(
      payloadOf({
        venueEvents: [
          congress({ uid: "a@x", summary: "Mon–Tue", start: "2026-07-20T02:00:00Z", end: "2026-07-21T08:00:00Z" }),
          congress({ uid: "b@x", summary: "Wed–Fri", start: "2026-07-22T02:00:00Z", end: "2026-07-24T08:00:00Z" }),
        ],
        portCalls: [],
      }),
    );
    switchView("week");
    expect(bands().map((b) => b.style.gridRow)).toEqual(["1", "1"]);
  });

  it("reserves the same lanes in a quiet week as in a busy one, so the grid never jumps", () => {
    mount(payloadOf({ venueEvents: [], portCalls: [] }));
    switchView("week");
    // The band is drawn even with nothing on it — its height is what a week
    // with four overlapping entries would need, so paging does not shift the
    // hour grid up and down.
    expect(root.querySelector(".week__allday")).not.toBeNull();
    expect(bands()).toHaveLength(0);
    expect(reservedLanes()).toBe(String(WEEK_BAND_LANES));

    mount(overlapping(4));
    switchView("week");
    expect(bands()).toHaveLength(4);
    expect(reservedLanes()).toBe(String(WEEK_BAND_LANES));
    expect(bandMore()).toBeNull();
  });

  it("spends the last reserved lane on `+N more` once there is overflow", () => {
    mount(overlapping(6));
    switchView("week");
    // Three bands, not four: the door costs the lane it occupies, so an
    // overflowing week is exactly as tall as one that fills the reservation.
    expect(bands().map((b) => b.textContent)).toEqual(["Fair 0", "Fair 1", "Fair 2"]);
    const more = bandMore();
    expect(more?.textContent).toMatch(/\+3 more/);
    expect(more?.style.gridRow).toBe(String(WEEK_BAND_LANES));
    expect(more?.style.gridColumn).toBe("1 / -1");
  });

  it("hands `+N more` to Agenda on the earliest hidden entry's day", () => {
    mount(
      payloadOf({
        venueEvents: [
          // Three from Monday fill the lanes the reservation shows…
          ...Array.from({ length: 3 }, (_, index) =>
            congress({
              uid: `m${index}@x`,
              summary: `Fair ${index}`,
              start: "2026-07-20T02:00:00Z",
              end: "2026-07-24T08:00:00Z",
            }),
          ),
          // …and these two, both starting Wednesday, are what overflows. The
          // reader is handed to the 22nd — where the hidden entries begin, not
          // where the week does.
          congress({ uid: "h1@x", summary: "Hidden Expo", start: "2026-07-22T02:00:00Z", end: "2026-07-24T08:00:00Z" }),
          congress({ uid: "h2@x", summary: "Hidden Fair", start: "2026-07-23T02:00:00Z", end: "2026-07-24T08:00:00Z" }),
        ],
        portCalls: [],
      }),
    );
    switchView("week");
    bandMore()?.click();
    expect(root.querySelector(".agenda")).not.toBeNull();
    expect(root.querySelector(".week")).toBeNull();
    expect(
      root.querySelector('.agenda__day[data-day="2026-07-22"]')?.textContent,
    ).toContain("Hidden Expo");
    expect(landedOn()).toBe("2026-07-22");
  });

  it("aims `+N more` at a hidden entry's own first day, even before the showing week", () => {
    // The overflowing entry runs into this week from the last one. The door goes
    // where it *begins* — Agenda draws it under every day it spans, so the
    // reader lands on the entry rather than on an arbitrary Monday.
    mount(
      payloadOf({
        // Five entries running 15 — 24 July: the band shows three and hides two,
        // and every one of them started five days before this week's Monday.
        venueEvents: Array.from({ length: 5 }, (_, index) =>
          congress({
            uid: `m${index}@x`,
            summary: `Fair ${index}`,
            start: "2026-07-15T02:00:00Z",
            end: "2026-07-24T08:00:00Z",
          }),
        ),
        portCalls: [],
      }),
    );
    switchView("week");
    bandMore()?.click();
    expect(landedOn()).toBe("2026-07-15");
  });

  it("draws a band as one line — the summary, ellipsised, with the rest on its title", () => {
    mount(payloadOf({ portCalls: [] })); // congress spans 17–19 July
    switchView("week");
    click("prev"); // the week holding 13–19 July
    const [band] = bands();
    expect(band?.textContent).toBe("Global MICE Congress");
    // A band is a leaf: stacking the location and the source under it would
    // undo the fixed lane height the reservation buys.
    expect(band?.querySelector(".calendar__entry-where, .calendar__source")).toBeNull();
    expect(band?.title).toBe("Global MICE Congress — Suntec Convention Centre, Level 4, Hall 404");
  });

  it("drops a port call's `Cruise: ` prefix on the band, as the chip does", () => {
    mount(
      payloadOf({
        venueEvents: [],
        portCalls: [cruise({ start: "2026-07-21T00:00:00Z", end: "2026-07-23T08:00:00Z" })],
      }),
    );
    switchView("week");
    expect(bands()[0]?.textContent).toBe("ODYSSEY / VILLA VIE RESIDENCES at Singapore Cruise Centre");
  });
});

describe("sticky header and today-to-top navigation (#73)", () => {
  const { scrolled, landedOn } = trackScrollTargets();

  /** Today (21 July) needs an entry for the reading surfaces to render its row. */
  const withToday = () =>
    payloadOf({
      venueEvents: [
        congress(),
        congress({
          uid: "today@x",
          summary: "Today Event",
          start: "2026-07-21T02:00:00Z",
          end: "2026-07-21T06:00:00Z",
        }),
      ],
      portCalls: [],
    });

  it("renders the controls inside the pinned topbar, beside the page heading", () => {
    mount(payloadOf());
    // h1 + period nav + view tabs + type filter all pinned together.
    expect(topbar.querySelector("h1")).not.toBeNull();
    expect(topbar.querySelector(".calendar__title")).not.toBeNull();
    expect(topbar.querySelector('[data-nav="today"]')).not.toBeNull();
    expect(topbar.querySelector('[data-view="agenda"]')).not.toBeNull();
    expect(topbar.querySelector(".calendar__filter")).not.toBeNull();
    // The scrolling surface stays in the root, below the pinned header.
    expect(root.querySelector(".calendar__controls")).toBeNull();
    expect(root.querySelector(".calendar__grid")).not.toBeNull();
  });

  it("publishes the topbar's measured height as --topbar-h", () => {
    mount(payloadOf());
    // jsdom measures every box as zero, so the value under test is that one is
    // published in px at all — `scroll-padding-top` in the shell consumes it.
    expect(document.documentElement.style.getPropertyValue("--topbar-h")).toMatch(/^[\d.]+px$/);
  });

  it("republishes --topbar-h when the viewport resizes", () => {
    // A resize re-wraps the header without re-rendering it, and a stale height
    // lands the next jump behind the header. jsdom measures every box as zero,
    // so the grown header is faked.
    mount(payloadOf());
    topbar.getBoundingClientRect = () => ({ height: 168 }) as DOMRect;
    window.dispatchEvent(new Event("resize"));
    expect(document.documentElement.style.getPropertyValue("--topbar-h")).toBe("168px");
  });

  it("brings today's row to the top of the viewport on first load", () => {
    mount(withToday());
    expect(landedOn()).toBe("2026-07-21");
  });

  it("brings today's row to the top on every view switch", () => {
    mount(withToday());
    for (const view of ["agenda", "spine", "week", "month"]) {
      switchView(view);
      expect(landedOn()).toBe("2026-07-21");
    }
    // The row landed on is the day's own row in the showing view, not the grid.
    switchView("agenda");
    expect(scrolled.at(-1)).toBe(root.querySelector('.agenda__day[data-day="2026-07-21"]'));
    switchView("spine");
    expect(scrolled.at(-1)).toBe(root.querySelector('.spine__date[data-day="2026-07-21"]'));
  });

  it("brings today's row to the top when Today is pressed from anywhere", () => {
    mount(withToday());
    click("prev");
    click("prev");
    const before = scrolled.length;
    click("today");
    expect(scrolled.length).toBeGreaterThan(before);
    expect(landedOn()).toBe("2026-07-21");
  });

  it("leaves the scroll alone when paging with Prev and Next", () => {
    // Paging is the reader moving deliberately — yanking them back to today's
    // row would undo the step they just took.
    mount(withToday());
    const before = scrolled.length;
    click("prev");
    click("next");
    expect(scrolled).toHaveLength(before);
  });

  it("keeps past days rendered — the reader scrolls up past them", () => {
    // The congress ran 17–19 July, all before the frozen 21 July "now". History
    // is not removed to make room for the present.
    mount(withToday());
    switchView("agenda");
    const days = Array.from(root.querySelectorAll(".agenda__day")).map(
      (n) => (n as HTMLElement).dataset["day"],
    );
    expect(days).toEqual(["2026-07-17", "2026-07-18", "2026-07-19", "2026-07-21"]);
    expect(summariesIn("2026-07-17")).toEqual([]); // (month grid is not showing)
    switchView("month");
    expect(summariesIn("2026-07-17")).toEqual(["Global MICE Congress"]);
  });

  it("falls back to the top of the surface when today is not on it", () => {
    // Two months back, today's row does not exist — the page still lands
    // somewhere sane rather than leaving the reader mid-scroll.
    mount(withToday());
    click("prev");
    click("prev");
    switchView("agenda");
    expect(landedOn()).toBeUndefined();
    expect(scrolled.at(-1)).toBe(root.querySelector(".calendar__surface"));
  });
});

describe("Agenda day-stepping navigation (#77)", () => {
  const { landedOn } = trackScrollTargets();

  /** A single-day venue event on a given Singapore date — 10:00–18:00 SGT. */
  const on = (date: string): Entry =>
    congress({ uid: `${date}@x`, summary: `Entry ${date}`, start: `${date}T02:00:00Z`, end: `${date}T10:00:00Z` });

  /**
   * Entry-days either side of the frozen 21 July, plus one in August. July's are
   * 10, 21 (today) and 24; August's are 3 and 28 — enough for a step inside the
   * month, a roll forward off the last one, and a roll back off the first.
   */
  const spread = () =>
    payloadOf({
      venueEvents: ["2026-07-10", "2026-07-21", "2026-07-24", "2026-08-03", "2026-08-28"].map(on),
      portCalls: [],
    });

  it("steps to the next entry-day, not the next month", () => {
    mount(spread());
    switchView("agenda"); // the cursor is seeded from today, 21 July
    click("next");
    expect(landedOn()).toBe("2026-07-24");
    expect(title()).toBe("July 2026");
    // The day is on the surface, and the empty days between were skipped.
    expect(root.querySelector('.agenda__day[data-day="2026-07-24"]')).not.toBeNull();
  });

  it("steps to the previous entry-day, skipping the empty days between", () => {
    mount(spread());
    switchView("agenda");
    click("prev");
    expect(landedOn()).toBe("2026-07-10");
    expect(title()).toBe("July 2026");
  });

  it("rolls into the adjacent month's nearest entry-day at either edge", () => {
    mount(spread());
    switchView("agenda");
    click("next"); // 24 July — July's last entry-day
    click("next"); // over the boundary, onto August's first
    expect(landedOn()).toBe("2026-08-03");
    expect(title()).toBe("August 2026");
    click("prev"); // back over the boundary, onto July's last
    expect(landedOn()).toBe("2026-07-24");
    expect(title()).toBe("July 2026");
  });

  it("keeps stepping by the entry-day across several months in a row", () => {
    mount(spread());
    switchView("agenda");
    for (const day of ["2026-07-24", "2026-08-03", "2026-08-28"]) {
      click("next");
      expect(landedOn()).toBe(day);
    }
  });

  it("falls back to a plain month step when there is no entry-day that way", () => {
    // July only, so Next off the last entry-day has nowhere to land. It must
    // still move — a nav control that does nothing reads as broken.
    mount(payloadOf({ venueEvents: [on("2026-07-24")], portCalls: [] }));
    switchView("agenda");
    click("next");
    expect(title()).toBe("July 2026"); // 21 July → 24 July, the one entry-day
    click("next");
    expect(title()).toBe("August 2026");
    click("next");
    expect(title()).toBe("September 2026");
  });

  it("carries the cursor with a fallback month step, so the next press moves on from there", () => {
    // The venue event is July's last; the port call is hidden by the filter, so
    // Next off it has nowhere to land and falls back to an August with nothing
    // in it. Widening the filter there must step back to 10 August — the nearest
    // day behind *where the reader now is*, not behind where they last landed.
    mount(
      payloadOf({
        venueEvents: [on("2026-07-24")],
        portCalls: [cruise({ start: "2026-08-10T00:00:00Z", end: "2026-08-10T08:00:00Z" })],
      }),
    );
    switchView("agenda");
    setFilter("VenueEvent");
    click("next"); // 24 July
    click("next"); // nothing ahead — the month step to August
    expect(title()).toBe("August 2026");
    setFilter("all");
    click("prev");
    expect(landedOn()).toBe("2026-08-10");
  });

  it("bounds the cross-month scan rather than sweeping the whole dataset", () => {
    // The next entry-day is 30 months out — past the 24-month scan — so Next
    // takes the month step instead of leaping years ahead of the reader.
    mount(payloadOf({ venueEvents: [on("2026-07-24"), on("2029-01-05")], portCalls: [] }));
    switchView("agenda");
    click("next"); // 24 July
    click("next");
    expect(title()).toBe("August 2026");
  });

  it("steps by the entry-days the current filter leaves showing", () => {
    mount(
      payloadOf({
        venueEvents: [on("2026-07-24")],
        portCalls: [cruise({ start: "2026-07-22T00:00:00Z", end: "2026-07-22T08:00:00Z" })],
      }),
    );
    switchView("agenda");
    setFilter("VenueEvent"); // 22 July is filtered out, so Next skips it
    click("next");
    expect(landedOn()).toBe("2026-07-24");
  });

  it("leaves Month, Week and Date-spine paging by their own unit", () => {
    mount(spread());
    for (const view of ["month", "spine"]) {
      switchView(view);
      click("next");
      expect(title()).toBe("August 2026");
      click("prev");
      expect(title()).toBe("July 2026");
    }
    switchView("week");
    click("next");
    expect(title()).toBe("27 Jul – 2 Aug 2026");
  });

  it("drills to a day in Agenda from anywhere, seeding the cursor there", () => {
    const calendar = mount(spread());
    // The drill-through Month's and Week's `+N more` controls will consume
    // (#80, #81): switch surface, seed the cursor, bring the day to the top.
    calendar.drillToAgendaDay(sgtDayIndex(new Date("2026-08-03T02:00:00Z")));
    expect((find('[data-view="agenda"]') as HTMLElement).getAttribute("aria-selected")).toBe("true");
    expect(title()).toBe("August 2026");
    expect(landedOn()).toBe("2026-08-03");
    // Seeded, not merely scrolled: the next step continues from the drilled day.
    click("next");
    expect(landedOn()).toBe("2026-08-28");
  });

  it("re-seeds the cursor on today when a view switch re-opens Agenda", () => {
    // A view switch already opens on the present (#73) while keeping the month
    // the reader had reached (§6), and the cursor comes home with the scroll: the
    // first step after arriving reads forward from today, landing on the showing
    // month's first entry-day rather than resuming the old wander at 28 August.
    mount(spread());
    switchView("agenda");
    click("next"); // 24 July
    click("next"); // 3 August — the anchor is now August
    switchView("month");
    switchView("agenda");
    click("next");
    expect(landedOn()).toBe("2026-08-03");
  });

  it("steps back from the cursor when the showing month is ahead of it", () => {
    // The mirror of the case above, and the one that used to break the control's
    // whole promise: reading *back* from a month that is already ahead of the
    // cursor can only land ahead of it. Prev must move back — onto 10 July, the
    // entry-day behind today — not forward onto 24 July.
    mount(spread());
    switchView("agenda");
    click("next"); // 24 July
    click("next"); // 3 August — the anchor is now August, the cursor with it
    switchView("month");
    switchView("agenda"); // the cursor comes home to 21 July; the anchor stays in August
    click("prev");
    expect(landedOn()).toBe("2026-07-10");
    expect(title()).toBe("July 2026");
  });

  it("steps on from the cursor when the showing month is behind it", () => {
    // The same defect the other way up: a Next that reads forward from a month
    // behind the cursor lands behind it too. The anchor says which month is
    // showing, but it never reverses the direction the reader pressed.
    mount(spread());
    switchView("agenda");
    click("prev"); // 10 July
    click("prev"); // nothing behind it — the month step back to June
    expect(title()).toBe("June 2026");
    switchView("month");
    switchView("agenda"); // the cursor comes home to 21 July; the anchor stays in June
    click("next");
    expect(landedOn()).toBe("2026-07-24");
  });

  it("resumes from today after Today is pressed, whatever the cursor was", () => {
    mount(spread());
    switchView("agenda");
    click("next"); // 24 July
    click("next"); // 3 August
    click("today");
    expect(landedOn()).toBe("2026-07-21");
    click("next");
    expect(landedOn()).toBe("2026-07-24");
  });
});

describe("the static shell (#73)", () => {
  // Read from the project root: this file runs in the jsdom environment, where
  // `import.meta.url` is an http URL rather than a file one.
  const shell = readFileSync("site/index.html", "utf8");

  it("pins the topbar and clears a jumped-to row of it with --topbar-h", () => {
    expect(shell).toMatch(/\.topbar\s*\{[^}]*position:\s*sticky/);
    expect(shell).toMatch(/scroll-padding-top:\s*var\(--topbar-h/);
  });

  it("keeps the h1 in the static markup, inside the pinned topbar", () => {
    expect(shell).toMatch(/<header class="topbar">[\s\S]*?<h1>[\s\S]*?<\/header>/);
  });
});

describe("per-source freshness disclosure (#40)", () => {
  const freshItem = (source: string) =>
    root.querySelector(`.calendar__freshness-item[data-source="${source}"]`);
  const agoText = (source: string) =>
    freshItem(source)?.querySelector(".calendar__freshness-ago")?.textContent;
  const isStale = (source: string) =>
    freshItem(source)?.classList.contains("calendar__freshness-item--stale") ?? false;

  it("computes 'X ago' from the baked instant and the injected clock (never a baked string)", () => {
    // The instant is machine-readable and baked at build; the elapsed text is the
    // browser's, against the clock the page is given — which is what makes the
    // disclosure honest when the build that produced it has since died.
    mount(
      payloadOf({ sources: [{ source: "suntec", lastConfirmed: "2026-07-21T00:00:00Z" }] }),
      new Date("2026-07-21T03:00:00Z"),
    );
    expect(agoText("suntec")).toBe("last confirmed 3 hours ago");
  });

  it("keeps the disclosure visible in every view", () => {
    mount(payloadOf({ sources: [{ source: "suntec", lastConfirmed: "2026-07-21T00:00:00Z" }] }));
    for (const view of ["month", "week", "agenda", "spine"]) {
      switchView(view);
      expect(freshItem("suntec")).not.toBeNull();
    }
  });

  it("renders a large, growing lag when the baked instant is far in the past", () => {
    // The failure the whole mechanism exists to survive: the pipeline is dead, so
    // the page is frozen — but read against a live clock the lag grows rather than
    // reassuring. Asserted explicitly with an injected clock.
    const frozen = payloadOf({ sources: [{ source: "suntec", lastConfirmed: "2026-07-01T00:00:00Z" }] });

    mount(frozen, new Date("2026-07-06T00:00:00Z"));
    expect(agoText("suntec")).toBe("last confirmed 5 days ago");
    expect(isStale("suntec")).toBe(true);

    // The same frozen bytes, opened ten days later, disclose a larger lag.
    mount(frozen, new Date("2026-07-16T00:00:00Z"));
    expect(agoText("suntec")).toBe("last confirmed 15 days ago");
  });

  it("stays calm under two days and escalates to a prominent warning at >= two days", () => {
    const payload = payloadOf({ sources: [{ source: "suntec", lastConfirmed: "2026-07-20T00:00:00Z" }] });

    mount(payload, new Date("2026-07-21T23:00:00Z")); // ~1.96 days — still calm
    expect(isStale("suntec")).toBe(false);
    expect(freshItem("suntec")?.querySelector(".calendar__freshness-warn")).toBeNull();

    mount(payload, new Date("2026-07-22T00:00:00Z")); // exactly two days — escalated
    expect(isStale("suntec")).toBe(true);
    expect(freshItem("suntec")?.querySelector(".calendar__freshness-warn")).not.toBeNull();
  });

  it("discloses each source on its own line, per source and never per record", () => {
    mount(
      payloadOf({
        sources: [
          { source: "suntec", lastConfirmed: "2026-07-21T00:00:00Z" },
          { source: "scc", lastConfirmed: "2026-07-19T00:00:00Z" },
        ],
      }),
      new Date("2026-07-21T02:00:00Z"),
    );
    expect(agoText("suntec")).toBe("last confirmed 2 hours ago");
    expect(agoText("scc")).toBe("last confirmed 2 days ago");
  });

  it("the model reads elapsed from the instant and flips stale at the two-day line", () => {
    const at = (iso: string) => freshness("2026-07-20T00:00:00Z", new Date(iso));
    expect(at("2026-07-20T00:00:30Z").text).toBe("just now");
    expect(at("2026-07-20T00:01:00Z").text).toBe("1 minute ago");
    expect(at("2026-07-20T01:00:00Z").text).toBe("1 hour ago");
    expect(at("2026-07-21T00:00:00Z").text).toBe("1 day ago");
    expect(at("2026-07-21T23:59:00Z").stale).toBe(false);
    expect(at("2026-07-22T00:00:00Z").stale).toBe(true);
  });
});
