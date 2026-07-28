// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  wireFeedCopy,
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

/**
 * The page's stylesheet, read as text. A wash, a fixed row height, a hairline
 * and the *absence* of a positional rule are all CSS facts, and jsdom applies no
 * stylesheet at all — so the two presentation blocks below (#72, #78) assert
 * against the source, and share these three helpers rather than each growing its
 * own parser.
 */
const shell = readFileSync("site/index.html", "utf8");

/** Every declaration block in the shell, comments stripped — a comment is not a rule. */
const cssRules = () =>
  Array.from(
    shell.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^}]*)\}/g),
    (match) => ({ selectors: (match[1] ?? "").split(","), body: match[2] ?? "" }),
  );

/**
 * Everything the stylesheet declares for one exact selector, wherever it says it
 * — a rule of its own, or a grouped one it shares.
 */
const ruleFor = (selector: string) =>
  cssRules()
    .filter((rule) => rule.selectors.some((one) => one.trim() === selector))
    .map((rule) => rule.body)
    .join("\n");

/** Does a node carry the weekend wash — by the class that names the day, not a position? */
const isWashed = (node: Element | null | undefined) =>
  node?.classList.contains("is-weekend") ?? false;

/** 21 July 2026, mid-morning Singapore — the frozen "now" the page lands on. */
const JULY_21 = new Date("2026-07-21T02:00:00Z");

let root: HTMLElement;
let topbar: HTMLElement;
let freshnessHost: HTMLElement;

/**
 * The page shell `site/index.html` supplies three hosts: a pinned
 * `<header class="topbar">` holding the static h1, into which the controls
 * render (#73); the mount root below it holding the scrolling surface; and the
 * methodology footer's freshness slot, below both (#79, ADR-0014 §2). The tests
 * build the same shell so the DOM under test is the DOM the page ships.
 */
beforeEach(() => {
  document.body.textContent = "";
  document.documentElement.removeAttribute("style");
  topbar = document.createElement("header");
  topbar.className = "topbar";
  topbar.appendChild(document.createElement("h1"));
  root = document.createElement("div");
  const methodology = document.createElement("section");
  methodology.className = "methodology";
  freshnessHost = document.createElement("div");
  freshnessHost.className = "methodology__freshness";
  methodology.appendChild(freshnessHost);
  document.body.append(topbar, root, methodology);
});

const mount = (payload: Payload, now: Date = JULY_21) =>
  mountCalendar(root, payload, now, { topbar, freshness: freshnessHost });

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
  /** Every declaration block whose selector counts positions in the grid. */
  const nthChildRules = () =>
    cssRules()
      .filter((rule) => rule.selectors.some((one) => one.includes("nth-child")))
      .map((rule) => ({ selector: rule.selectors.join(",").trim(), body: rule.body }));
  const weekdayHeaders = () => Array.from(root.querySelectorAll(".calendar__weekday"));
  const weekend = isWashed;

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

  /**
   * One Date-spine row as a percentage of a July track, and the three readers
   * the spine's geometry assertions share. The renderer publishes whole-row
   * percentages as custom properties and the stylesheet insets them by a
   * hairline, so `style.top` is a `calc()` no assertion can parse — these read
   * the geometry where it is stated, in rows.
   */
  const SPINE_ROW = 100 / 31;
  const barByType = (type: string) =>
    root.querySelector(`.spine__bar[data-type="${type}"]`) as HTMLElement;
  const barTop = (bar: HTMLElement) => parsePct(bar.style.getPropertyValue("--spine-bar-top"));
  const barHeight = (bar: HTMLElement) =>
    parsePct(bar.style.getPropertyValue("--spine-bar-height"));

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

  it("Date-spine spans whole day rows — one row is the floor, and a bar starts on its row's edge", () => {
    // Congress 17–19 July SGT (three dates, ~2.25 days on the clock); cruise
    // 18 July 08:00–16:00 SGT (one date, a third of a day).
    mount(payloadOf());
    switchView("spine");
    // The spine's unit is the **date**: three dates is exactly three rows, one
    // date exactly one — never the fraction of a row the clock would give, which
    // is unreadable and collides with whatever shares the lane.
    expect(barHeight(barByType("VenueEvent"))).toBeCloseTo(SPINE_ROW * 3, 4);
    expect(barHeight(barByType("PortCall"))).toBeCloseTo(SPINE_ROW, 4);

    // And a bar begins at its day's row edge, so it lines up with the date on
    // the axis beside it rather than starting part-way down at 08:00.
    expect(barTop(barByType("VenueEvent"))).toBeCloseTo(SPINE_ROW * 16, 4);
    expect(barTop(barByType("PortCall"))).toBeCloseTo(SPINE_ROW * 17, 4);

    // The clock the geometry rounded off is *not* on the bar — it is the detail
    // bubble's job since #100, and the bar's whole surface is the name.
    expect(barByType("VenueEvent").textContent).not.toContain("2.3 days");
    expect(barByType("PortCall").textContent).not.toContain("8 hr");
  });

  it("Date-spine draws only the days inside the month it is showing", () => {
    // Neither entry starts and ends inside July, and both must draw the part
    // that does: the congress reaches back into June, the call forward into
    // August. The clamp is inclusive at both ends — `end` is the last day drawn,
    // not one past it — so an off-by-one here shows up as a whole extra row.
    mount(
      payloadOf({
        venueEvents: [congress({ start: "2026-06-29T02:00:00Z", end: "2026-07-02T08:00:00Z" })],
        portCalls: [cruise({ start: "2026-07-30T02:00:00Z", end: "2026-08-02T08:00:00Z" })],
      }),
    );
    switchView("spine");

    // 29 June – 2 July: July draws the 1st and the 2nd, flush to the top.
    expect(barTop(barByType("VenueEvent"))).toBeCloseTo(0, 4);
    expect(barHeight(barByType("VenueEvent"))).toBeCloseTo(SPINE_ROW * 2, 4);

    // 30 July – 2 August: July draws the 30th and the 31st, and stops at the
    // foot of the track rather than running past it.
    expect(barTop(barByType("PortCall"))).toBeCloseTo(SPINE_ROW * 29, 4);
    expect(barHeight(barByType("PortCall"))).toBeCloseTo(SPINE_ROW * 2, 4);

    // And the clamp counts the rows actually drawn, not the entry's true span:
    // both are 3.3 days but only two rows of each are in July, so each gets the
    // three lines two rows hold. Counting the whole entry would clamp to five
    // and the name would run past the clip edge with no ellipsis.
    expect(barByType("VenueEvent").style.getPropertyValue("--spine-bar-lines")).toBe("3");
    expect(barByType("PortCall").style.getPropertyValue("--spine-bar-lines")).toBe("3");
  });

  it("Date-spine insets its bars, so consecutive days in one lane stay two bars", () => {
    // The renderer publishes whole-row percentages; the hairline that keeps two
    // bars apart is the stylesheet's, applied to those percentages. Both halves
    // have to hold or the bars paint flush and read as one continuous band.
    mount(payloadOf());
    switchView("spine");
    const bar = root.querySelector(".spine__bar") as HTMLElement;
    expect(bar.style.getPropertyValue("--spine-bar-top")).toMatch(/%$/);
    expect(bar.style.getPropertyValue("--spine-bar-height")).toMatch(/%$/);
    const rule = ruleFor(".spine__bar");
    expect(rule).toMatch(/top:\s*calc\(var\(--spine-bar-top\)\s*\+\s*1px\)/);
    expect(rule).toMatch(/height:\s*calc\(var\(--spine-bar-height\)\s*-\s*2px\)/);
    // And no floor in the stylesheet — the geometry carries it.
    expect(rule).not.toMatch(/min-height/);
  });

  it("Date-spine keeps a gutter between neighbouring lanes, so two types never share an edge", () => {
    // The lane geometry is published as clean percentages, like the row geometry
    // above, and the stylesheet insets it. Painted flush — which is what setting
    // `left`/`width` directly did — a green PortCall's background abuts a blue
    // VenueEvent's 3px border with nothing between them, and two lanes read as
    // one continuous band.
    mount(payloadOf()); // congress 17–19 July, cruise 18 July: concurrent, two lanes
    switchView("spine");
    const bars = Array.from(root.querySelectorAll(".spine__bar")) as HTMLElement[];
    expect(bars).toHaveLength(2);
    for (const bar of bars) {
      expect(bar.style.getPropertyValue("--spine-bar-left")).toMatch(/%$/);
      expect(bar.style.getPropertyValue("--spine-bar-width")).toMatch(/%$/);
      // Nothing sets the properties themselves — the inset is the stylesheet's.
      expect(bar.style.left).toBe("");
      expect(bar.style.width).toBe("");
    }
    // Two lanes, each half the track, side by side.
    expect(bars.map((b) => parsePct(b.style.getPropertyValue("--spine-bar-width")))).toEqual([50, 50]);
    expect(
      bars.map((b) => parsePct(b.style.getPropertyValue("--spine-bar-left"))).sort((a, b) => a - b),
    ).toEqual([0, 50]);

    const rule = ruleFor(".spine__bar");
    expect(rule).toMatch(/left:\s*calc\(var\(--spine-bar-left\)\s*\+\s*1px\)/);
    expect(rule).toMatch(/width:\s*calc\(var\(--spine-bar-width\)\s*-\s*2px\)/);
  });

  it("Date-spine's bar is the name alone — the only line a one-date bar has goes to it", () => {
    // A one-date bar is one `--spine-row` tall, because its height *is* its
    // duration (ADR-0009 §3): 22.8px of content box, one 13.8px line. #99 spent
    // that single line on the duration and clipped the name away on most of the
    // month (#100), so the duration comes off the bar altogether — to the detail
    // bubble's Length row, the one surface that shows an entry in full.
    mount(payloadOf());
    switchView("spine");
    const bar = barByType("PortCall");

    // The name, and only the name — one node, no lead label. The `Cruise: `
    // prefix is dropped so the vessel survives the width.
    expect(bar.textContent).toBe("ODYSSEY / VILLA VIE RESIDENCES at Singapore Cruise Centre");
    expect(bar.children).toHaveLength(1);
    expect(bar.children[0]?.className).toBe("spine__name");
    expect(bar.querySelector(".spine__len")).toBeNull();

    // The three fields that do not fit are gone from the bar, not merely hidden.
    // Where and source are one hover away; the duration is a double-click away,
    // and deliberately *not* added to the title — the tooltip stays the place a
    // dropped label field lands, and Length belongs to the bubble (#75).
    expect(bar.querySelector(".calendar__entry-where, .calendar__source")).toBeNull();
    expect(bar.title).toContain("Cruise: ODYSSEY / VILLA VIE RESIDENCES");
    expect(bar.title).toContain("Singapore Cruise Centre");
    expect(bar.title).toContain("scc");
    expect(bar.title).not.toContain("8 hr");

    // The bar carries its own type scale, not `.calendar__entry`'s. It is a
    // preference now, not a constraint (#100): the smaller face buys characters
    // per line, and a fifth line on a three-row bar.
    expect(bar.classList.contains("calendar__entry")).toBe(false);
    const rule = ruleFor(".spine__bar");
    expect(rule).toMatch(/font-size:\s*0\.72rem/);
    expect(rule).toMatch(/line-height:\s*1\.2/);
    expect(rule).toMatch(/padding:\s*0\.1rem\s+0\.3rem/);
  });

  it("Date-spine's name fills every line its bar's height allows, then ellipsises", () => {
    // The count is a function of the span, so only the renderer can know it: a
    // one-date bar holds 22.8px / 13.8px = one line, a three-date bar 78.8px =
    // five. Clipping silently instead leaves a truncated title and a short one
    // looking identical, which is half of what #100 reports.
    mount(payloadOf());
    switchView("spine");

    expect(barByType("PortCall").style.getPropertyValue("--spine-bar-lines")).toBe("1");
    expect(barByType("VenueEvent").style.getPropertyValue("--spine-bar-lines")).toBe("5");

    // The stylesheet reads that count as its clamp — the ellipsis, not a clip.
    const name = ruleFor(".spine__name");
    expect(name).toMatch(/-webkit-line-clamp:\s*var\(--spine-bar-lines\)/);
    expect(name).toMatch(/-webkit-box-orient:\s*vertical/);
    expect(name).toMatch(/display:\s*-webkit-box/);
    // A single long word in a narrow lane breaks rather than vanishing past the
    // clip edge — the horizontal half of "as much of the name as possible".
    expect(name).toMatch(/overflow-wrap:\s*anywhere/);

    // And the clamp is on the inner box, *not* the bar. The bar is absolutely
    // positioned, so it is blockified — `-webkit-box` computes to `flow-root`
    // there and the clamp is silently ignored. jsdom cannot catch that (it
    // applies no stylesheet at all), so the guard is that the declaration does
    // not move back onto the positioned element.
    const rule = ruleFor(".spine__bar");
    expect(rule).toMatch(/position:\s*absolute/);
    expect(rule).not.toMatch(/line-clamp/);

    // `spineBarLines` counts in px the stylesheet owns. Drift does not throw —
    // it silently clamps to a line count the bar no longer has — so the four
    // values it assumes are asserted here, at the seam.
    expect(ruleFor(".spine")).toMatch(/--spine-row:\s*1\.75rem/);
    expect(rule).toMatch(/height:\s*calc\(var\(--spine-bar-height\)\s*-\s*2px\)/);
  });

  it("Date-spine gives an entry its own lane when it shares a date with one that ends that day", () => {
    // The congress runs 20–22 July SGT and the call is the evening of the 22nd.
    // On the clock they do not overlap — the congress closes at 16:00, the call
    // opens at 18:00 — but they occupy the same *date*, and a spine drawn in
    // whole day rows would stack one on top of the other in a shared lane. The
    // packer is half-open, so the renderer hands it `endIndex + 1`.
    mount(
      payloadOf({
        venueEvents: [congress({ start: "2026-07-20T02:00:00Z", end: "2026-07-22T08:00:00Z" })],
        portCalls: [cruise({ start: "2026-07-22T10:00:00Z", end: "2026-07-22T14:00:00Z" })],
      }),
    );
    switchView("spine");
    const bars = Array.from(root.querySelectorAll(".spine__bar")) as HTMLElement[];
    expect(bars).toHaveLength(2);
    // Two lanes: each bar takes half the track, and they sit at different offsets.
    // Read off the published lane geometry, not `left`/`width` themselves — the
    // stylesheet owns those, because it is what insets the gutter into them.
    for (const bar of bars) {
      expect(parsePct(bar.style.getPropertyValue("--spine-bar-width"))).toBeCloseTo(50, 4);
    }
    expect(new Set(bars.map((bar) => bar.style.getPropertyValue("--spine-bar-left"))).size).toBe(2);
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
      // Month draws chips, Date-spine draws bars, the other reading surfaces draw
      // entries — the filter is one rule over all three, so the assertion has to
      // cover whichever node the view renders.
      const shown = (type: string) =>
        root.querySelectorAll(
          `.calendar__entry[data-type="${type}"], .calendar__chip[data-type="${type}"], .spine__bar[data-type="${type}"]`,
        ).length;
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

describe("Week: legibility marks, header alignment and the weekend wash (#78)", () => {
  const weekDay = (day: string) => root.querySelector(`.week__day[data-day="${day}"]`);
  const weekCol = (day: string) => root.querySelector(`.week__col[data-day="${day}"]`);
  const weekend = isWashed;
  const hairlines = () =>
    Array.from(root.querySelectorAll(".week__grid .week__hline")) as HTMLElement[];

  it("quarters the day with hairlines at 06:00, 12:00 and 18:00, behind the events", () => {
    mount(payloadOf());
    switchView("week");
    // A quarter of the 24-hour column each: an event's time reads off its
    // vertical position without counting from the gutter.
    expect(hairlines().map((line) => line.style.top)).toEqual(["25%", "50%", "75%"]);
    // Drawn before the columns, so the events positioned inside them paint over.
    const grid = root.querySelector(".week__grid") as HTMLElement;
    const kinds = Array.from(grid.children, (node) => node.className);
    expect(kinds.slice(0, 3)).toEqual(["week__hline", "week__hline", "week__hline"]);
  });

  it("quarters the day once, across the grid, not eight times inside each column", () => {
    // The columns used to paint their own three-hourly stripes. Two griddings of
    // one axis are two competing readings of it, and only the hairlines start
    // where the gutter ends — so the column keeps no rule of its own.
    expect(ruleFor(".week__col")).not.toMatch(/repeating-linear-gradient/);
  });

  it("starts the hairlines after the hour-label gutter, off the gutter's own width", () => {
    // One source for the gutter width, so the hairline cannot start half a
    // column early the next time the gutter is resized.
    expect(ruleFor(".week__hline")).toMatch(/left:\s*var\(--week-gutter\)/);
    expect(ruleFor(".week")).toMatch(/--week-gutter:/);
  });

  it("closes the day at 24:00 with the line the all-day band opens it with at 00:00", () => {
    expect(ruleFor(".week__grid")).toMatch(/border-bottom:\s*1px solid var\(--line\)/);
    expect(ruleFor(".week__allday")).toMatch(/border-bottom:\s*1px solid var\(--line\)/);
  });

  it("holds the header row to a fixed height, centred, whatever appears in it", () => {
    const rule = ruleFor(".week__day");
    expect(rule).toMatch(/align-items:\s*center/);
    expect(rule).toMatch(/min-height:/);
  });

  it("keeps the header row's shape whether or not the disc or a month label shows", () => {
    mount(payloadOf());
    switchView("week");
    click("next"); // Mon 27 Jul – Sun 2 Aug: no today, and a month boundary
    // Every cell is the same three-part row — weekday, numeral, and the month
    // name only where a month opens — so nothing in it can grow the row.
    expect(weekDay("2026-07-28")?.textContent).toBe("Tue28");
    expect(weekDay("2026-08-01")?.textContent).toBe("Sat1Aug");
    expect(weekDay("2026-08-01")?.querySelector(".calendar__monthname")?.textContent).toBe("Aug");
    expect(weekDay("2026-07-31")?.querySelector(".calendar__monthname")).toBeNull();
  });

  it("gives the month-boundary label an explicit small size, not the cell's 1rem", () => {
    // Month's date row sets 0.8rem around it, so the label used to look right
    // there and render oversized in Week, which has no such row.
    expect(ruleFor(".calendar__monthname")).toMatch(/font-size:\s*0\.8rem/);
  });

  it("washes the Saturday and Sunday header cells and hour columns, by class", () => {
    mount(payloadOf());
    switchView("week");
    // 25 and 26 July 2026 are the Saturday and Sunday of today's week.
    expect(weekend(weekDay("2026-07-25"))).toBe(true);
    expect(weekend(weekDay("2026-07-26"))).toBe(true);
    expect(weekend(weekDay("2026-07-24"))).toBe(false); // Friday
    expect(weekend(weekDay("2026-07-20"))).toBe(false); // Monday
    expect(weekend(weekCol("2026-07-25"))).toBe(true);
    expect(weekend(weekCol("2026-07-26"))).toBe(true);
    expect(weekend(weekCol("2026-07-24"))).toBe(false);
    expect(weekend(weekCol("2026-07-20"))).toBe(false);
  });

  it("runs the wash unbroken from the header through the band to the foot of the grid", () => {
    // Three surfaces, one grey: the header cell, the hour column, and — because
    // the band is a single seven-column grid, not seven nodes — a gradient over
    // its last two sevenths. Anything less reads as three unrelated stripes.
    expect(shell).toMatch(/\.week__day\.is-weekend,\s*\.week__col\.is-weekend\s*\{[^}]*var\(--weekend\)/);
    expect(ruleFor(".week__band-grid")).toMatch(
      /linear-gradient\([^)]*71\.4286%[^)]*var\(--weekend\)/,
    );
  });

  it("carries the weekend on the model's day, so the grid never counts columns", () => {
    // The Week grid holds the gutter and the hairlines as leading children, so
    // an `nth-child` wash lands three columns off. (#72's Month block asserts
    // no positional rule paints anywhere in the stylesheet.)
    const today = sgtDayIndex(JULY_21);
    const week = weekDaysOf(today, today);
    expect(week.map((d) => d.isWeekend)).toEqual([false, false, false, false, false, true, true]);
  });
});

describe("Date-spine: week-boundary lines (#74)", () => {
  const parsePct = (value: string) => Number.parseFloat(value.replace("%", ""));
  const weekLines = () => Array.from(root.querySelectorAll(".spine__week")) as HTMLElement[];
  const spine = () => root.querySelector(".spine") as HTMLElement;

  const openSpine = () => {
    mount(payloadOf());
    switchView("spine");
  };

  it("draws a boundary line at the top of each Monday, and on no other day", () => {
    openSpine();
    // July 2026 opens on a Wednesday, so its Mondays are the 6th, 13th, 20th and 27th.
    expect(weekLines().map((line) => line.dataset["day"])).toEqual([
      "2026-07-06",
      "2026-07-13",
      "2026-07-20",
      "2026-07-27",
    ]);
  });

  it("re-reads the Mondays from the month it is showing, never a fixed stride", () => {
    openSpine();
    click("next"); // August 2026 opens on a Saturday — a different offset entirely
    expect(weekLines().map((line) => line.dataset["day"])).toEqual([
      "2026-08-03",
      "2026-08-10",
      "2026-08-17",
      "2026-08-24",
      "2026-08-31",
    ]);
  });

  it("lands each line on the top edge of its Monday's row, not somewhere inside it", () => {
    openSpine();
    // The track measures the same 31 days the axis lists, so the fraction of the
    // month a Monday opens at *is* the top of its row on the axis beside it.
    expect(weekLines()).toHaveLength(4);
    for (const line of weekLines()) {
      const day = Number((line.dataset["day"] ?? "").slice(-2));
      expect(parsePct(line.style.top)).toBeCloseTo(((day - 1) / 31) * 100, 4);
    }
  });

  it("holds the axis and the track to one row unit, so a percentage means the same on both", () => {
    // The track used to be a flat `min-height`, which agreed with the axis only
    // in a 31-day month; in a 30-day one every bar — and now every week line —
    // sat a row's worth low by the foot of the month.
    expect(ruleFor(".spine__axis")).toMatch(/grid-auto-rows:\s*var\(--spine-row\)/);
    expect(ruleFor(".spine__track")).toMatch(
      /height:\s*calc\(var\(--spine-days\)\s*\*\s*var\(--spine-row\)\)/,
    );
    openSpine();
    expect(spine().style.getPropertyValue("--spine-days")).toBe("31");
  });

  it("measures a 30-day month by its own length, not a 31-day one's", () => {
    // The case the flat minimum height got wrong. September 2026 has 30 days and
    // opens on a Tuesday, so its last Monday — the 28th — is 27/30 of the way
    // down a track that has to be 30 rows tall, not 31.
    openSpine();
    click("next"); // August
    click("next"); // September
    expect(spine().style.getPropertyValue("--spine-days")).toBe("30");
    const lines = weekLines();
    expect(lines.map((line) => line.dataset["day"])).toEqual([
      "2026-09-07",
      "2026-09-14",
      "2026-09-21",
      "2026-09-28",
    ]);
    expect(parsePct((lines.at(-1) as HTMLElement).style.top)).toBeCloseTo((27 / 30) * 100, 4);
  });

  it("reaches back across the gap and the axis, so the line spans the whole spine", () => {
    // One source for the two widths it has to undo — the line cannot drift off
    // the axis the next time the spine's columns are resized.
    expect(ruleFor(".spine")).toMatch(/grid-template-columns:\s*var\(--spine-axis\) 1fr/);
    expect(ruleFor(".spine")).toMatch(/gap:\s*var\(--spine-gap\)/);
    const rule = ruleFor(".spine__week");
    expect(rule).toMatch(/left:\s*calc\(-1 \* \(var\(--spine-axis\) \+ var\(--spine-gap\)\)\)/);
    expect(rule).toMatch(/right:\s*0/);
  });

  it("draws the week stronger than the day, and behind the bars it bands", () => {
    // The daily hairline is --line (18%); the week boundary is 32%, so weeks
    // stand out from days rather than joining them.
    expect(ruleFor(".spine__date")).toMatch(/border-top:\s*1px solid var\(--line\)/);
    expect(ruleFor(".spine__week")).toMatch(
      /border-top:\s*1px solid color-mix\(in srgb, currentColor 32%, transparent\)/,
    );
    // Behind, and inert: appended before the bars, and no target for a pointer.
    expect(ruleFor(".spine__week")).toMatch(/pointer-events:\s*none/);
    openSpine();
    const track = root.querySelector(".spine__track") as HTMLElement;
    expect(Array.from(track.children, (node) => node.className).slice(0, 4)).toEqual([
      "spine__week",
      "spine__week",
      "spine__week",
      "spine__week",
    ]);
    expect(track.querySelector(".spine__bar")).not.toBeNull();
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

  it("evicts a remounted-over mount's resize listener instead of accumulating them", () => {
    // #84: every mount registers a resize listener holding *its* topbar. Without
    // eviction they pile up for the life of the page, N-1 of them dead weight.
    // Track the "resize" handlers *this test* registers by wrapping the
    // window's own registry. Identity, not a count: earlier tests in this file
    // mounted into the same jsdom window and their handlers retire on the same
    // dispatch, which a bare counter would charge to this test.
    const resizeHandlers = new Set<unknown>();
    const { addEventListener: add, removeEventListener: remove } = window;
    window.addEventListener = function (this: Window, type: string, handler: unknown, ...rest: never[]) {
      if (type === "resize") resizeHandlers.add(handler);
      return add.call(this, type, handler as EventListener, ...rest);
    } as typeof window.addEventListener;
    window.removeEventListener = function (this: Window, type: string, handler: unknown, ...rest: never[]) {
      if (type === "resize") resizeHandlers.delete(handler);
      return remove.call(this, type, handler as EventListener, ...rest);
    } as typeof window.removeEventListener;
    const live = () => resizeHandlers.size;

    try {
      mount(payloadOf());
      // The page replaces the shell wholesale: the first mount's header leaves
      // the document, and a fresh one takes its place.
      topbar.remove();
      const second = document.createElement("header");
      second.className = "topbar";
      document.body.prepend(second);
      root.textContent = "";
      mountCalendar(root, payloadOf(), JULY_21, { topbar: second, freshness: freshnessHost });
      expect(live()).toBe(2);

      second.getBoundingClientRect = () => ({ height: 168 }) as DOMRect;
      window.dispatchEvent(new Event("resize"));
      // The stale handler noticed its header was gone and unregistered itself;
      // the live one still published.
      expect(live()).toBe(1);
      expect(document.documentElement.style.getPropertyValue("--topbar-h")).toBe("168px");

      second.getBoundingClientRect = () => ({ height: 42 }) as DOMRect;
      window.dispatchEvent(new Event("resize"));
      expect(live()).toBe(1);
      expect(document.documentElement.style.getPropertyValue("--topbar-h")).toBe("42px");
    } finally {
      window.addEventListener = add;
      window.removeEventListener = remove;
    }
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

describe("the page chrome (#79, ADR-0014 §2 and §3)", () => {
  /** The methodology footer's markup, from its opening tag to its closing one. */
  const footer = shell.match(/<section class="methodology">([\s\S]*?)<\/section>/)?.[1] ?? "";

  it("names the page with an h1 and leaves no lede above the calendar", () => {
    // The h1 is what a reader (and a crawler) meets first; the marketing prose
    // that used to sit between it and the grid is demoted into the footer, so
    // the calendar is the first thing under the header.
    expect(shell).toMatch(/<h1>[^<]*Singapore[\s\S]*?<\/h1>/);
    expect(shell).not.toMatch(/class="lede"/);
  });

  it("puts the methodology footer below the calendar, carrying the lede prose", () => {
    expect(footer).not.toBe("");
    expect(shell.indexOf('<section class="methodology">')).toBeGreaterThan(
      shell.indexOf('id="calendar"'),
    );
    expect(footer).toMatch(/<h2>Methodology notes<\/h2>/);
    expect(footer).toContain("existence and timing");
  });

  it("hosts the freshness disclosure in the footer, above the notes", () => {
    // Demoted, not deleted (ADR-0014 §2): the shell owns *where* the disclosure
    // sits, `calendar.js` owns what it says — which is still computed in the
    // browser, so a frozen page grows its own lag.
    expect(footer).toContain('class="methodology__freshness"');
    expect(footer.indexOf('class="methodology__freshness"')).toBeLessThan(
      footer.indexOf('class="note"'),
    );
  });

  it("ends the methodology notes with the Singapore-time caption (ADR-0014 §3)", () => {
    const notes = footer.match(/<p class="note">([\s\S]*?)<\/p>/)?.[1] ?? "";
    expect(notes.trim()).toMatch(/Days shown in Singapore time\.$/);
  });
});

describe("per-source freshness disclosure (#40)", () => {
  // Queried from the page, not from `root`: the disclosure was demoted out of
  // the mount root into the methodology footer (#79, ADR-0014 §2).
  const freshItem = (source: string) =>
    document.body.querySelector(`.calendar__freshness-item[data-source="${source}"]`);
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

  it("renders into the methodology footer, not into the calendar (#79)", () => {
    // Demoted, not deleted (ADR-0014 §2): still present, still client-computed,
    // still a live region — only its prominence drops. A screen reader has to
    // keep hearing the lag, so the `role=status` moves with it.
    mount(payloadOf({ sources: [{ source: "suntec", lastConfirmed: "2026-07-21T00:00:00Z" }] }));
    const list = freshnessHost.querySelector(".calendar__freshness");
    expect(list).not.toBeNull();
    expect(list?.getAttribute("role")).toBe("status");
    expect(root.querySelector(".calendar__freshness")).toBeNull();
  });

  it("replaces the disclosure on a remount rather than stacking a second one", () => {
    // The footer host is the page's and outlives the mount, so — like the
    // topbar's controls — a second mount has to clear what the first left.
    const payload = payloadOf({ sources: [{ source: "suntec", lastConfirmed: "2026-07-21T00:00:00Z" }] });
    mount(payload);
    mount(payload);
    expect(freshnessHost.querySelectorAll(".calendar__freshness")).toHaveLength(1);
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

/**
 * The entry-detail bubble (#75). Its **content** is a pure function of the entry
 * — which is what these tests drive, through a real `dblclick` on a real node in
 * each of the four views, exactly as a reader opens it.
 *
 * Its **geometry** is deliberately outside this seam. `positionBubble` reads
 * `getBoundingClientRect` and `offsetWidth` and compares them against the
 * viewport; jsdom has no layout engine, so every one of those is zero and the
 * flip, the clamp and the tail offset cannot be exercised here at all. What is
 * asserted instead is that the position was *applied* — the bubble is anchored
 * in viewport coordinates with a tail offset published — and that the rules the
 * geometry depends on exist in the shell's stylesheet. The numbers themselves
 * are checked by eye against the prototype, as the round-1 items before it were.
 */
describe("the entry-detail bubble (#75)", () => {
  const sources = [
    { source: "suntec", lastConfirmed: "2026-07-21T00:00:00Z" },
    { source: "scc", lastConfirmed: "2026-07-19T00:00:00Z" },
  ];

  /** How a reader opens it: a double-click on the entry's own node. */
  const dblclick = (node: Element | null | undefined) => {
    expect(node).not.toBeNull();
    node?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true }));
  };
  const bubble = () => document.body.querySelector(".calendar__bubble");
  const bubbles = () => document.body.querySelectorAll(".calendar__bubble");
  const titleOf = () => bubble()?.querySelector(".calendar__bubble-title")?.textContent;
  const chipOf = () => bubble()?.querySelector(".calendar__bubble-chip")?.textContent;
  const footOf = () => bubble()?.querySelector(".calendar__bubble-foot")?.textContent;
  /** The data-record grid, read back as the label/value pairs it draws. */
  const fields = () => {
    const grid = bubble()?.querySelector(".calendar__bubble-grid");
    const terms = Array.from(grid?.querySelectorAll("dt") ?? []).map((n) => n.textContent);
    const values = Array.from(grid?.querySelectorAll("dd") ?? []).map((n) => n.textContent);
    return Object.fromEntries(terms.map((term, index) => [term, values[index]]));
  };

  it("opens on a double-click on a Month chip, showing the fields the chip hides", () => {
    mount(payloadOf({ portCalls: [], sources }));
    expect(bubble()).toBeNull();

    dblclick(chipsIn("2026-07-18")[0]);
    expect(titleOf()).toBe("Global MICE Congress");
    expect(chipOf()).toBe("Venue event");
    expect(bubble()?.getAttribute("data-type")).toBe("VenueEvent");
    // The multi-day congress: a date range, its two clock times joined by an
    // arrow rather than a dash, its hall in full, and its span.
    expect(fields()).toEqual({
      When: "Fri 17 Jul – Sun 19 Jul 2026",
      Time: "10:00 → 16:00 SGT",
      Where: "Suntec Convention Centre, Level 4, Hall 404",
      Length: "2.3 days",
    });
  });

  it("names a single day once, with its clock times either side of a dash", () => {
    mount(payloadOf({ venueEvents: [], sources }));
    dblclick(chipsIn("2026-07-18")[0]);
    expect(fields()["When"]).toBe("Sat 18 Jul 2026");
    expect(fields()["Time"]).toBe("08:00 – 16:00 SGT");
    expect(fields()["Length"]).toBe("8 hr");
  });

  it("strips a port call's `Cruise: ` prefix and names its type in the reader's words", () => {
    mount(payloadOf({ venueEvents: [], sources }));
    dblclick(chipsIn("2026-07-18")[0]);
    expect(titleOf()).toBe("ODYSSEY / VILLA VIE RESIDENCES at Singapore Cruise Centre");
    expect(chipOf()).toBe("Cruise arrival");
    expect(bubble()?.getAttribute("data-type")).toBe("PortCall");
  });

  it("is the only surface that says how long, now the Date-spine bar has stopped", () => {
    // Since #100 the bar draws the name alone, and day-row geometry rounds a
    // 2.25-day congress and a 3-day one to the same three rows. So this is where
    // the clock survives — the bubble, one double-click from the bar that no
    // longer carries it (ADR-0016).
    mount(payloadOf({ portCalls: [], sources }));
    switchView("spine");
    const bar = root.querySelector(".spine__bar");
    expect(bar?.textContent).not.toContain("2.3 days");
    dblclick(bar);
    expect(fields()["Length"]).toBe("2.3 days");
  });

  it("footers the entry's own source and how long ago that source was confirmed", () => {
    // Per source, from the same `payload.sources` and injected clock the page's
    // freshness disclosure reads — the congress and the cruise come from two
    // sources confirmed two days apart, and each bubble says its own.
    mount(payloadOf({ sources }), new Date("2026-07-21T02:00:00Z"));
    dblclick(chipsIn("2026-07-17")[0]);
    expect(footOf()).toBe("suntec · confirmed 2 hours ago");

    dblclick(chipsIn("2026-07-18").at(-1));
    expect(footOf()).toBe("scc · confirmed 2 days ago");
  });

  it("names the source alone when the payload discloses no instant for it", () => {
    // A payload with no `sources` at all — the attribution is still honest; only
    // the "how long ago" it cannot compute is missing.
    mount(payloadOf({ portCalls: [] }));
    dblclick(chipsIn("2026-07-17")[0]);
    expect(footOf()).toBe("suntec");
  });

  it("opens from Week's all-day band, Week's timed entry, Agenda and Date-spine", () => {
    mount(
      payloadOf({
        venueEvents: [congress()], // 17–19 July: Week draws it on the all-day band
        portCalls: [cruise({ start: "2026-07-21T00:00:00Z", end: "2026-07-21T08:00:00Z" })],
        sources,
      }),
    );

    switchView("week");
    dblclick(root.querySelector(".week__event")); // the timed cruise, in today's column
    expect(chipOf()).toBe("Cruise arrival");

    click("prev"); // back to the week holding 17–19 July
    dblclick(root.querySelector(".week__band:not(.week__band--more)"));
    expect(titleOf()).toBe("Global MICE Congress");

    switchView("agenda");
    dblclick(root.querySelector(".agenda .calendar__entry"));
    expect(titleOf()).toBe("Global MICE Congress");

    switchView("spine");
    dblclick(root.querySelector(".spine__bar"));
    expect(titleOf()).toBe("Global MICE Congress");
  });

  it("leaves the `+N more` doors alone — they navigate, they do not describe", () => {
    const busy = payloadOf({
      venueEvents: Array.from({ length: 6 }, (_, index) =>
        congress({
          uid: `m${index}@x`,
          summary: `Fair ${index}`,
          start: "2026-07-21T02:00:00Z",
          end: "2026-07-23T08:00:00Z",
        }),
      ),
      portCalls: [],
      sources,
    });

    mount(busy);
    dblclick(moreIn("2026-07-21"));
    expect(bubble()).toBeNull();

    switchView("week");
    dblclick(root.querySelector(".week__band--more"));
    expect(bubble()).toBeNull();
  });

  it("keeps one bubble open at a time, whichever entry is opened next", () => {
    mount(payloadOf({ sources }));
    dblclick(chipsIn("2026-07-17")[0]);
    dblclick(chipsIn("2026-07-18").at(-1));
    expect(bubbles()).toHaveLength(1);
    expect(chipOf()).toBe("Cruise arrival");
  });

  it("anchors in viewport coordinates and reveals the bubble only once placed", () => {
    // The geometry itself is outside this seam (see the block comment): what is
    // asserted is that the placement ran — a tail offset published, a vertical
    // side chosen, and the bubble revealed after rather than before it.
    mount(payloadOf({ sources }));
    dblclick(chipsIn("2026-07-17")[0]);
    const node = bubble() as HTMLElement;
    expect(node.style.left).not.toBe("");
    expect(node.style.top).not.toBe("");
    expect(node.style.getPropertyValue("--tail-x")).not.toBe("");
    expect(node.classList.contains("calendar__bubble--below")).toBe(true);
    expect(node.style.visibility).toBe("");
    // It hangs off the body, not inside a scrolling surface that would clip it.
    expect(node.parentElement).toBe(document.body);
  });

  it("dismisses on a click outside it, and stays open on a click inside", () => {
    mount(payloadOf({ sources }));
    dblclick(chipsIn("2026-07-17")[0]);
    bubble()?.querySelector(".calendar__bubble-title")
      ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(bubble()).not.toBeNull();

    document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    expect(bubble()).toBeNull();
  });

  it("dismisses on Escape, and on no other key", () => {
    mount(payloadOf({ sources }));
    dblclick(chipsIn("2026-07-17")[0]);
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "a", bubbles: true }));
    expect(bubble()).not.toBeNull();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(bubble()).toBeNull();
  });

  it("dismisses on any scroll, including one inside a surface's own scroller", () => {
    // The bubble is positioned in viewport coordinates, so a scroll detaches it
    // from the entry it points at. Week's hour grid scrolls inside the page and
    // its scroll event does not bubble — only a capture-phase listener sees it.
    mount(
      payloadOf({
        venueEvents: [congress({ start: "2026-07-21T02:00:00Z", end: "2026-07-21T08:00:00Z" })],
        portCalls: [],
        sources,
      }),
    );
    switchView("week");
    dblclick(root.querySelector(".week__event"));
    expect(bubble()).not.toBeNull();
    root.querySelector(".week")?.dispatchEvent(new Event("scroll")); // does not bubble
    expect(bubble()).toBeNull();

    dblclick(root.querySelector(".week__event"));
    window.dispatchEvent(new Event("scroll"));
    expect(bubble()).toBeNull();
  });

  it("closes on a resize rather than leaving a tail pointing at nothing", () => {
    mount(payloadOf({ sources }));
    dblclick(chipsIn("2026-07-17")[0]);
    window.dispatchEvent(new Event("resize"));
    expect(bubble()).toBeNull();
  });

  it("takes its bubble with it when it retires on a resize, rather than stranding it", () => {
    // The bubble hangs off the body, not off the mount's root, so it outlives
    // the surfaces it points at. A handler that evicted itself *before* closing
    // would leave a popover in the page pointing at nothing, with every path
    // that could dismiss it already retired.
    mount(payloadOf({ sources }));
    dblclick(chipsIn("2026-07-17")[0]);
    const opened = bubble();
    expect(opened).not.toBeNull();

    topbar.remove(); // the mount's surfaces leave the page…
    root.remove();
    expect(bubble()).toBe(opened); // …and the bubble, on the body, does not

    window.dispatchEvent(new Event("resize"));
    expect(bubble()).toBeNull();
  });

  it("takes it with it on the document's dismissal path too", () => {
    mount(payloadOf({ sources }));
    dblclick(chipsIn("2026-07-17")[0]);
    topbar.remove();
    root.remove();
    expect(bubble()).not.toBeNull();

    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    expect(bubble()).toBeNull();
  });

  it("retires a replaced mount's dismissal listeners instead of accumulating them", () => {
    // The listeners live on the document and the window, which outlive a mount —
    // the same self-eviction the topbar's resize handler does (#84). A remount
    // must not leave the old mount's handlers firing for the life of the page.
    const removed: string[] = [];
    const realRemove = document.removeEventListener.bind(document);
    document.removeEventListener = ((type: string, ...rest: unknown[]) => {
      removed.push(type);
      return realRemove(type, ...(rest as [EventListenerOrEventListenerObject]));
    }) as typeof document.removeEventListener;

    try {
      mount(payloadOf({ sources })); // the mount that is about to be replaced
      document.body.textContent = ""; // …and its root leaves the page
      topbar = document.createElement("header");
      topbar.className = "topbar";
      root = document.createElement("div");
      document.body.append(topbar, root);
      mount(payloadOf({ sources }));

      dblclick(chipsIn("2026-07-17")[0]);
      document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    } finally {
      document.removeEventListener = realRemove;
    }

    // The stale handler retired itself on the one firing it saw…
    expect(removed).toContain("keydown");
    // …and the live one did its job on the same firing.
    expect(bubble()).toBeNull();
  });

  it("carries the prototype's visual identity — accent band, record grid, tail", () => {
    // jsdom applies no stylesheet, so the bubble's look is asserted against the
    // shell's CSS: the variant-E identity settled in `prototype/event-bubble`.
    // The type accent, in the entry's own colour.
    expect(ruleFor(".calendar__bubble-accent")).toMatch(/height:\s*4px/);
    expect(ruleFor(".calendar__bubble-accent")).toMatch(/background:\s*#2563eb/);
    expect(shell).toMatch(
      /\.calendar__bubble\[data-type="PortCall"\]\s+\.calendar__bubble-accent\s*\{[^}]*#0d9488/,
    );
    // The data-record grid: uppercase labels beside their values.
    expect(ruleFor(".calendar__bubble-grid")).toMatch(/grid-template-columns:\s*auto 1fr/);
    expect(ruleFor(".calendar__bubble-grid dt")).toMatch(/text-transform:\s*uppercase/);
    // Anchored in viewport coordinates, above the surfaces, with a tail that
    // flips with the bubble and follows `--tail-x` when it is clamped.
    expect(ruleFor(".calendar__bubble")).toMatch(/position:\s*fixed/);
    expect(ruleFor(".calendar__bubble")).toMatch(/border-radius:\s*0\.6rem/);
    // The prototype's lift, at its own weight: a popover that sits heavier than
    // the bake-off's is a different bubble, in the one round that spec'd look.
    expect(ruleFor(".calendar__bubble")).toMatch(/box-shadow:\s*0 6px 22px[^;]*16%/);
    expect(shell).toMatch(/\.calendar__bubble--below::before[^{]*\{[^}]*var\(--tail-x\)/);
    expect(shell).toMatch(/\.calendar__bubble--above::before[^{]*\{[^}]*var\(--tail-x\)/);
  });
});

/**
 * The subscription block (#76), quietened to what a reader actually needs: a
 * heading, the two feeds split by type (ADR-0008), and a Copy button each. The
 * intro line, the per-app "how to add it" steps and the subscribe-not-import
 * caveat are gone — the product owner's edit.
 *
 * The markup is **static shell**, not module output, so it is asserted against
 * the file's text like the rest of the shell above; only the copying is
 * behaviour, and it gets its own block below.
 */
describe("the ICS Calendar Subscription block (#76)", () => {
  /** The block's markup, from its heading to the end of the feed rows. */
  const feeds = shell.match(/<h2>ICS Calendar Subscription<\/h2>([\s\S]*?)<\/div>\s*<\/div>/)?.[0] ?? "";
  const rows = Array.from(feeds.matchAll(/<div class="feed">([\s\S]*?)<\/div>/g), (m) => m[1] ?? "");

  it("heads exactly two feed rows, one per type", () => {
    expect(feeds).not.toBe("");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("SG Venue Events");
    expect(rows[1]).toContain("SG Cruise Arrivals");
  });

  it("shows an absolute .ics URL and a Copy button carrying the same URL", () => {
    // Absolute, not relative: a relative URL cannot be subscribed to in a
    // calendar app, and what is copied has to be what is shown.
    const feedUrl = (slug: string) =>
      `https://edw93d.github.io/20260716SingaporeTourismCalendar/feeds/${slug}.ics`;
    for (const [row, slug] of [
      [rows[0] ?? "", "venue-events"],
      [rows[1] ?? "", "port-calls"],
    ] as const) {
      expect(row).toContain(`<code class="feed__url">${feedUrl(slug)}</code>`);
      expect(row).toMatch(
        new RegExp(`<button class="feed__copy" data-url="${feedUrl(slug)}">Copy</button>`),
      );
    }
  });

  it("drops the intro line, the per-app steps and the subscribe-not-import caveat", () => {
    expect(shell).not.toMatch(/<h2>Subscribe<\/h2>/);
    expect(shell).not.toContain("not an import");
    // The relative-link list the block replaces — see the URL assertion above
    // for why a relative feed URL was never subscribable in the first place.
    expect(shell).not.toMatch(/<a href="feeds\//);
  });

  it("sits below the methodology notes", () => {
    expect(shell.indexOf("<h2>ICS Calendar Subscription</h2>")).toBeGreaterThan(
      shell.indexOf('<section class="methodology">'),
    );
  });

  it("draws the rows at the prototype's spacing, type scale and radius", () => {
    expect(ruleFor(".feeds")).toMatch(/gap:\s*0\.5rem/);
    expect(ruleFor(".feed")).toMatch(/border:\s*1px solid var\(--line\)/);
    expect(ruleFor(".feed")).toMatch(/border-radius:\s*0\.5rem/);
    expect(ruleFor(".feed")).toMatch(/padding:\s*0\.5rem 0\.7rem/);
    expect(ruleFor(".feed__name")).toMatch(/font-size:\s*0\.9rem/);
    expect(ruleFor(".feed__url")).toMatch(/font-size:\s*0\.78rem/);
    expect(ruleFor(".feed__url")).toMatch(/color:\s*var\(--dim\)/);
    // Everything `.feed__copy` is declared, wherever it is said — so the button
    // wearing the page's one chrome-button look (the grouped rule it joins) is
    // as much a fact here as its own smaller size, and neither can quietly
    // become a second look.
    expect(ruleFor(".feed__copy")).toMatch(/font-size:\s*0\.75rem/);
    expect(ruleFor(".feed__copy")).toMatch(/border-radius:\s*0\.5rem/);
    expect(ruleFor(".feed__copy")).toMatch(/border:\s*1px solid var\(--line\)/);
  });
});

describe("copying a feed URL (#76)", () => {
  /** The shell's two feed rows, rebuilt in jsdom — the DOM `wireFeedCopy` meets. */
  const feedRows = () => {
    const host = document.createElement("div");
    host.className = "feeds";
    for (const url of ["https://x.test/feeds/venue-events.ics", "https://x.test/feeds/port-calls.ics"]) {
      const row = document.createElement("div");
      row.className = "feed";
      const button = document.createElement("button");
      button.className = "feed__copy";
      button.dataset["url"] = url;
      button.textContent = "Copy";
      row.appendChild(button);
      host.appendChild(row);
    }
    document.body.appendChild(host);
    return host;
  };

  const buttons = (host: Element) =>
    Array.from(host.querySelectorAll(".feed__copy")) as HTMLButtonElement[];

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("writes the row's own absolute URL and confirms, reverting after ~1.2s", async () => {
    const written: string[] = [];
    const host = feedRows();
    wireFeedCopy(host, { writeText: async (text: string) => void written.push(text) });

    const [venue, port] = buttons(host);
    venue?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(written).toEqual(["https://x.test/feeds/venue-events.ics"]);
    expect(venue?.textContent).toBe("Copied");

    // Only the pressed button confirms — the other row is untouched.
    expect(port?.textContent).toBe("Copy");

    await vi.advanceTimersByTimeAsync(1200);
    expect(venue?.textContent).toBe("Copy");
  });

  it("restarts the confirmation on a second press rather than letting the first end it", async () => {
    // Two presses 1s apart: the first press's timer must not fire under the
    // second's confirmation and revert a label that is 200ms old.
    const host = feedRows();
    wireFeedCopy(host, { writeText: async () => {} });

    const [venue] = buttons(host);
    venue?.click();
    await vi.advanceTimersByTimeAsync(1000);
    venue?.click();
    await vi.advanceTimersByTimeAsync(400); // 1.2s past the first press
    expect(venue?.textContent).toBe("Copied");
    await vi.advanceTimersByTimeAsync(800); // 1.2s past the second
    expect(venue?.textContent).toBe("Copy");
  });

  it("degrades silently when the clipboard is unavailable", async () => {
    // A sandboxed frame or an insecure origin has no clipboard at all. Nothing
    // is claimed that did not happen: the label stays "Copy" and the URL beside
    // it is still there to select by hand.
    const host = feedRows();
    wireFeedCopy(host, undefined);

    const [venue] = buttons(host);
    venue?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(venue?.textContent).toBe("Copy");
  });

  it("degrades silently when the write is refused", async () => {
    const host = feedRows();
    wireFeedCopy(host, {
      writeText: async () => {
        throw new Error("denied");
      },
    });

    const [venue] = buttons(host);
    venue?.click();
    await vi.advanceTimersByTimeAsync(0);
    expect(venue?.textContent).toBe("Copy");
  });
});
