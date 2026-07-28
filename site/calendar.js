// @ts-check

/**
 * The web calendar's client layer — **seam 3** (#38): pure model logic plus a
 * DOM renderer, both with the two things they cannot be allowed to reach for
 * themselves injected as arguments — the **document** (`root.ownerDocument`) and
 * the **clock** (`now`). That injection is the whole point of the seam: it is
 * what lets `tests/calendar.test.ts` render the real page against jsdom with time
 * frozen, and it is why nothing in this file calls `new Date()` or touches a
 * global `document`. The page's bootstrap in `index.html` supplies both.
 *
 * Hand-rolled, no calendar library (ADR-0009 left the component choice open; #38
 * needs only the Month view, so vanilla is the honest amount of code). The whole
 * file is free software under AGPLv3 with the rest of the repository.
 *
 * **Month is a navigator, not a reading surface** (#5, ADR-0009 §2): it answers
 * "which days have demand?", lands on today, and drills through to the reading
 * surfaces rather than trying to be one.
 *
 * Four switchable views (ADR-0009): **Month** navigates; **Week**, **Agenda**
 * and **Date-spine** are the reading surfaces. No single one is *the* view —
 * reading demand from several angles is the feature. There is **no magnitude**
 * in any of them (ADR-0009 §5): span and names stand in for the size the data
 * does not carry, and nothing is ranked or scored.
 *
 * Two surfaces are **bounded**, and collapse what they cannot fit behind a
 * `+N more` — a Month cell (#80, ADR-0014 §1) and Week's all-day band (#81).
 * That is not the magnitude #5 disqualified: the door counts what one bounded
 * surface could not draw and names a destination, rather than ranking a day
 * against its neighbours. (This paragraph replaces the file's original
 * "no `+N more` collapse … nothing is collapsed" claim, which ADR-0014 §1
 * recorded as implementation debt when it restored ADR-0009's overflow intent.)
 *
 * @typedef {{ uid: string, summary: string, start: string, end: string, location: string, source: string }} SiteEntry
 * @typedef {{ source: string, lastConfirmed: string }} SourceFreshness
 * @typedef {{ venueEvents: SiteEntry[], portCalls: SiteEntry[], sources?: SourceFreshness[] }} SitePayload
 * @typedef {"VenueEvent" | "PortCall"} RecordType
 * @typedef {"all" | RecordType} Filter
 * @typedef {"month" | "week" | "agenda" | "spine"} View
 * @typedef {SiteEntry & { type: RecordType, startKey: number, endKey: number, startIndex: number, endIndex: number, startValue: number, endValue: number }} DayEntry
 * @typedef {{ topbar: Element, freshness: Element }} MountOptions
 */

/**
 * Singapore is a **fixed +08:00** with no DST since 1982 (the same static fact
 * `src/feeds/ical.ts` leans on). The whole product describes the Singapore
 * market, so every "which day is this?" question is answered in Singapore time,
 * not the viewer's — a Sydney hotelier and a London one must see a Suntec
 * congress land on the same square.
 */
const SGT_OFFSET_MS = 8 * 60 * 60 * 1000;

/**
 * A UTC instant shifted so its `getUTC*` fields *read as* Singapore civil time —
 * the one move every day/month question here starts from.
 * @param {Date} instant
 * @returns {Date}
 */
const toSgt = (instant) => new Date(instant.getTime() + SGT_OFFSET_MS);

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * A continuous **SGT-day axis**: whole days since 1970-01-01 in Singapore time,
 * fractional within a day. This is the one number Week and Date-spine position
 * against — subtracting two of them is an elapsed span with no month-boundary or
 * DST special case (Singapore has had neither since 1982). `Math.floor` of it is
 * the integer day index a civil SGT date maps to.
 * @param {Date} instant
 * @returns {number}
 */
const sgtDayValue = (instant) => (instant.getTime() + SGT_OFFSET_MS) / MS_PER_DAY;

/**
 * The integer day index of a civil SGT date `Y-M-D` — the same axis as
 * `sgtDayValue`, so `dayIndexOf(y, m, d) === Math.floor(sgtDayValue(midnight))`.
 * @param {number} year @param {number} month @param {number} day @returns {number}
 */
const dayIndexOf = (year, month, day) => Math.round(Date.UTC(year, month - 1, day) / MS_PER_DAY);

/**
 * The inverse: the civil SGT date an integer day index names.
 * @param {number} index @returns {{ year: number, month: number, day: number }}
 */
const civilOf = (index) => {
  const at = new Date(index * MS_PER_DAY);
  return { year: at.getUTCFullYear(), month: at.getUTCMonth() + 1, day: at.getUTCDate() };
};

/**
 * The integer SGT day an instant falls on, on the `sgtDayValue` axis.
 * @param {Date} instant @returns {number}
 */
export const sgtDayIndex = (instant) => Math.floor(sgtDayValue(instant));

/**
 * Minutes since Singapore midnight (0–1439) — the vertical position Week reads
 * from an entry's **true published clock time**, not the viewer's.
 * @param {Date} instant @returns {number}
 */
export const sgtMinutesOfDay = (instant) => {
  const shifted = toSgt(instant);
  return shifted.getUTCHours() * 60 + shifted.getUTCMinutes();
};

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** Monday-first: business planning reads the working week as a unit. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * How many chip-sized **rows** a Month cell holds (ADR-0014 §1) — four is what
 * fits at the cell height that keeps the month on one screen. It is a row budget,
 * not a chip count, which is the whole of the cap rule in {@link renderMonth}:
 * four chips when four is all there is, otherwise three plus a `+N more`, because
 * the control spends a row like a chip does.
 */
const MONTH_CELL_ROWS = 4;

/**
 * How many lanes Week's **all-day band** always reserves (#81). It is a
 * reservation, not a cap on the data: the band is drawn to this height whether
 * the week holds nothing or overflows it, so paging from a quiet week to a busy
 * one never shifts the hour grid under it. Four is what the real dataset's worst
 * week needs, so the overflow door is insurance rather than everyday behaviour.
 */
export const WEEK_BAND_LANES = 4;

/**
 * How many of a surface's `rows` actually hold entries, given `needed` of them
 * want one. The rule both bounded surfaces share (#80, #81): the `+N more` door
 * **spends a row like an entry does**, so a Month cell that overflows is exactly
 * as tall as one that fills its cap, and an overflowing week is exactly as tall
 * as one that fills the band. Below the ceiling nothing is hidden — the cap is a
 * bound, not a truncation.
 * @param {number} needed @param {number} rows @returns {number}
 */
const rowsForEntries = (needed, rows) => (needed > rows ? rows - 1 : rows);

/** The number of days in a civil month. @param {number} year @param {number} month @returns {number} */
const monthLength = (year, month) => new Date(Date.UTC(year, month, 0)).getUTCDate();

/**
 * The Monday-starting day index of the week that contains `index`. Day index 0
 * (1970-01-01) is a Thursday — three days past Monday — so `(index + 3) % 7` is
 * any day's distance back to its Monday, and its position in a Monday-first
 * `WEEKDAYS`. Both the week views' geometry and their weekday labels read from
 * this single fact.
 * @param {number} index @returns {number}
 */
const mondayOf = (index) => index - ((index + 3) % 7);

/** The Monday-first weekday label for a day index. @param {number} index @returns {string} */
const weekdayLabel = (index) => WEEKDAYS[(index + 3) % 7] ?? "";

/**
 * The `Date.getUTCDay()` weekday (0=Sun) of a day index, for the day-indexed
 * views to reach {@link isWeekend} with — Week has no `Date` in hand where it
 * needs the answer, only the index. Day index 0 (1970-01-01) is a Thursday,
 * which is `getUTCDay()` 4; {@link mondayOf} counts the same Thursday from a
 * Monday-first zero, three places along, which is why its offset is 3 and this
 * one's is 4.
 * @param {number} index @returns {number}
 */
const weekdayOf = (index) => (index + 4) % 7;

/**
 * Saturday or Sunday, from a `Date.getUTCDay()` weekday (0=Sun). The weekend is
 * a property of the *day*, which is the whole of #72's wash rule: the grid marks
 * it with a class read from this, never by counting columns.
 * @param {number} weekday @returns {boolean}
 */
const isWeekend = (weekday) => weekday === 0 || weekday === 6;

/**
 * The weekend column labels, **derived** from the same predicate the day cells
 * use rather than restated as strings — the header and the cells under it wash
 * on one fact, so they cannot drift apart. `WEEKDAYS` is Monday-first, so its
 * column `i` is the `(i + 1) % 7` weekday.
 */
const WEEKEND_LABELS = new Set(WEEKDAYS.filter((_, column) => isWeekend((column + 1) % 7)));

/**
 * A calendar day in Singapore time, as a comparable `YYYYMMDD` integer — which
 * orders chronologically as a plain number, so "does this day fall inside this
 * span?" is two `<=` with no date arithmetic and no month-boundary special case.
 *
 * @param {Date} instant
 * @returns {number}
 */
export const sgtDayKey = (instant) => {
  const shifted = toSgt(instant);
  return (
    shifted.getUTCFullYear() * 10000 +
    (shifted.getUTCMonth() + 1) * 100 +
    shifted.getUTCDate()
  );
};

/** @param {number} year @param {number} month @param {number} day */
const dayKey = (year, month, day) => year * 10000 + month * 100 + day;

/**
 * The Singapore month a moment falls in — the page's default focus.
 * @param {Date} now
 * @returns {{ year: number, month: number }}
 */
export const sgtMonthOf = (now) => {
  const shifted = toSgt(now);
  return { year: shifted.getUTCFullYear(), month: shifted.getUTCMonth() + 1 };
};

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

/**
 * Two days is where a calm disclosure escalates to a prominent warning (#40). It
 * is comfortably past a single skipped daily run — a dropped schedule costs one
 * day of freshness and self-heals — so the warning fires on a *pattern*, not a
 * one-off miss, and never on a healthy overnight gap.
 */
const STALE_AFTER_MS = 2 * MS_PER_DAY;

/** @param {number} count @param {string} unit @returns {string} */
const agoUnit = (count, unit) => `${count} ${unit}${count === 1 ? "" : "s"} ago`;

/**
 * The freshness disclosure for one source, **computed at page load** from the
 * baked ISO instant and the injected clock — never a baked relative string. That
 * is load-bearing (#40, #17): the static site is built by the same workflow that
 * scrapes, so a baked "4 hours ago" would freeze *forever* the moment the
 * pipeline died, reassuring the operator at exactly the moment it is dead.
 * Computed here, a frozen page instead shows an ever-growing lag — which is the
 * page's role as the only always-true proof the pipeline ran.
 *
 * `stale` escalates at {@link STALE_AFTER_MS}; a clock earlier than the instant
 * (skew, or a same-second build) reads as "just now", never a negative age.
 *
 * @param {string} lastConfirmed ISO-8601 instant baked by the build
 * @param {Date} now the injected clock
 * @returns {{ elapsedMs: number, text: string, stale: boolean }}
 */
export const freshness = (lastConfirmed, now) => {
  const elapsedMs = now.getTime() - new Date(lastConfirmed).getTime();
  const text =
    elapsedMs < MS_PER_MINUTE ? "just now"
    : elapsedMs < MS_PER_HOUR ? agoUnit(Math.floor(elapsedMs / MS_PER_MINUTE), "minute")
    : elapsedMs < MS_PER_DAY ? agoUnit(Math.floor(elapsedMs / MS_PER_HOUR), "hour")
    : agoUnit(Math.floor(elapsedMs / MS_PER_DAY), "day");
  return { elapsedMs, text, stale: elapsedMs >= STALE_AFTER_MS };
};

/**
 * Tag both record types with their kind and pre-compute the SGT day span each
 * occupies, so the grid never re-parses an instant. Order within a type is
 * preserved and the two types are concatenated — **nothing is merged or
 * sorted by any magnitude** (ADR-0004, ADR-0009 §5).
 *
 * @param {SitePayload} payload
 * @returns {DayEntry[]}
 */
export const normalizeEntries = (payload) => {
  /** @param {SiteEntry} entry @param {RecordType} type @returns {DayEntry} */
  const tag = (entry, type) => {
    const start = new Date(entry.start);
    const end = new Date(entry.end);
    return {
      ...entry,
      type,
      startKey: sgtDayKey(start),
      endKey: sgtDayKey(end),
      startIndex: sgtDayIndex(start),
      endIndex: sgtDayIndex(end),
      startValue: sgtDayValue(start),
      endValue: sgtDayValue(end),
    };
  };
  return [
    ...payload.venueEvents.map((entry) => tag(entry, "VenueEvent")),
    ...payload.portCalls.map((entry) => tag(entry, "PortCall")),
  ];
};

/**
 * The interactive counterpart to the two baked feeds (ADR-0009 §4). Defaults to
 * `all`; `VenueEvent` / `PortCall` narrow to one type.
 *
 * @param {DayEntry[]} entries
 * @param {Filter} filter
 * @returns {DayEntry[]}
 */
export const filterEntries = (entries, filter) =>
  filter === "all" ? entries : entries.filter((entry) => entry.type === filter);

/**
 * Every entry that occupies a given day — **a multi-day entry is demand on every
 * one of its days** (ADR-0009 §3), so it is returned for each day its span
 * covers, not just its first.
 *
 * @param {DayEntry[]} entries
 * @param {number} key
 * @returns {DayEntry[]}
 */
export const entriesOnDay = (entries, key) =>
  entries.filter((entry) => entry.startKey <= key && key <= entry.endKey);

/**
 * The cells of a month's grid, Monday-first, padded to whole weeks with the
 * trailing/leading days of the adjacent months (marked `inMonth: false`).
 *
 * `isWeekend` is the day's own property, read from its date (#72) — not its
 * position in the returned array. That is what lets the grid mark the wash with
 * a class instead of counting children, which drifts the moment anything else is
 * added to the grid.
 *
 * @param {number} year
 * @param {number} month  1–12
 * @param {number} todayKey
 * @returns {{ year: number, month: number, day: number, key: number, inMonth: boolean, isToday: boolean, isWeekend: boolean }[]}
 */
export const monthGridCells = (year, month, todayKey) => {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay(); // 0=Sun
  const lead = (firstWeekday + 6) % 7; // days to back up to Monday
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const weeks = Math.ceil((lead + daysInMonth) / 7);

  const cells = [];
  for (let index = 0; index < weeks * 7; index += 1) {
    // A UTC date at midnight, advanced one civil day at a time. No DST exists in
    // this zone, so civil-day arithmetic on UTC midnights cannot skip or double.
    const date = new Date(Date.UTC(year, month - 1, 1 - lead + index));
    const cellYear = date.getUTCFullYear();
    const cellMonth = date.getUTCMonth() + 1;
    const cellDay = date.getUTCDate();
    const key = dayKey(cellYear, cellMonth, cellDay);
    cells.push({
      year: cellYear,
      month: cellMonth,
      day: cellDay,
      key,
      inMonth: cellMonth === month && cellYear === year,
      isToday: key === todayKey,
      isWeekend: isWeekend(date.getUTCDay()),
    });
  }
  return cells;
};

/**
 * The seven days of the Monday-first week that contains `anchorIndex` (a
 * `sgtDayIndex`). Week paging works by moving the anchor ±7; the view always
 * shows the whole working-and-weekend week the anchor lands in.
 *
 * `isWeekend` is the day's own property, exactly as it is on a Month cell (#72,
 * #78) — Week needs it more, not less: its grid carries the hour gutter and the
 * hairlines as leading children, so a wash counted from the front of the grid
 * lands three columns off.
 *
 * @param {number} anchorIndex
 * @param {number} todayIndex
 * @returns {{ year: number, month: number, day: number, index: number, key: number, isToday: boolean, isWeekend: boolean }[]}
 */
export const weekDaysOf = (anchorIndex, todayIndex) => {
  const monday = mondayOf(anchorIndex);
  const days = [];
  for (let offset = 0; offset < 7; offset += 1) {
    const index = monday + offset;
    const { year, month, day } = civilOf(index);
    days.push({
      year,
      month,
      day,
      index,
      key: dayKey(year, month, day),
      isToday: index === todayIndex,
      isWeekend: isWeekend(weekdayOf(index)),
    });
  }
  return days;
};

/**
 * The days of a civil month that **have entries**, as day indices in ascending
 * order. Agenda renders one row per day in this list *and* steps along it (#77),
 * so the stepper cannot land on a day the surface does not draw.
 *
 * (#77 calls these "event-days". The glossary bans a bare **event** — a row here
 * may be a PortCall, which nobody attends — so the code says **entry-day**, the
 * word the rest of this module already uses. CONTEXT.md §Event.)
 *
 * @param {DayEntry[]} entries already filtered by type
 * @param {number} year
 * @param {number} month 1–12
 * @returns {number[]}
 */
export const entryDaysIn = (entries, year, month) => {
  const days = [];
  for (let day = 1; day <= monthLength(year, month); day += 1) {
    if (entriesOnDay(entries, dayKey(year, month, day)).length) days.push(dayIndexOf(year, month, day));
  }
  return days;
};

/**
 * How far {@link stepAgendaDay} will scan for an entry-day in the months either
 * side before giving up. Two years is well past any gap the daily sources
 * plausibly leave, and it is what stops a sparse dataset — or an empty one —
 * from sweeping every month there could ever be on one click.
 */
const AGENDA_SCAN_MONTHS = 24;

/** The civil month `delta` months from `year`/`month`. @param {number} year @param {number} month @param {number} delta */
const addMonths = (year, month, delta) => {
  const zeroBased = month - 1 + delta;
  return {
    year: year + Math.floor(zeroBased / 12),
    month: ((zeroBased % 12) + 12) % 12 + 1,
  };
};

/**
 * The anchor a whole month's page away, keeping the day-of-month where the
 * target month is long enough to have one. Month, Date-spine and Agenda's
 * fallback all page by this same unit.
 * @param {number} anchor @param {number} delta @returns {number}
 */
const monthStep = (anchor, delta) => {
  const { year, month, day } = civilOf(anchor);
  const next = addMonths(year, month, delta);
  return dayIndexOf(next.year, next.month, Math.min(day, monthLength(next.year, next.month)));
};

/**
 * Months since year 0, so two civil months can be compared as one number.
 * @param {{ year: number, month: number }} civil
 * @returns {number}
 */
const monthOrdinal = ({ year, month }) => year * 12 + month;

/**
 * The month the search reads from. Normally the showing month — a reader paging
 * Agenda steps through what is in front of them. But the anchor and the cursor
 * can part company: a view switch brings the cursor home to today while the
 * anchor stays on the month the reader had paged to (#73 §6). Reading *back*
 * from a month already ahead of the cursor can only land ahead of it — a Prev
 * that moves the reader forwards — and reading *forward* from a month behind it
 * is the same fault upside down. So when the anchor sits the wrong side of the
 * cursor for the direction pressed, the cursor's own month is where the search
 * honestly starts. The anchor says which month is showing; it never reverses the
 * direction the reader asked for.
 *
 * @param {number} anchor @param {number} cursor @param {number} direction
 * @returns {{ year: number, month: number }}
 */
const searchMonthOf = (anchor, cursor, direction) => {
  const showing = civilOf(anchor);
  const at = civilOf(cursor);
  const anchorLeads = monthOrdinal(showing) > monthOrdinal(at);
  // Forwards, take whichever month is later; backwards, whichever is earlier.
  return (direction > 0) === anchorLeads ? showing : at;
};

/**
 * Agenda's Next/Prev, as a pure move (#77). Agenda is a **list of the days that
 * have entries**, so paging it by the month steps over whole screens of nothing;
 * it steps by the **entry-day** instead — the next or previous day the surface
 * actually draws a row for, rolling into the adjacent months at the edges.
 *
 * The scan across months is bounded ({@link AGENDA_SCAN_MONTHS}), and when it
 * finds nothing the move degrades to a plain {@link monthStep}: a Next that
 * silently does nothing reads as a broken control, so this always returns a
 * different anchor. `day` is the entry-day landed on, or `null` for that
 * fallback — the caller scrolls to the former and has nothing to scroll to in
 * the latter.
 *
 * Whichever it returns, the day landed on lies in the direction pressed: see
 * {@link searchMonthOf} for the case that makes that worth stating.
 *
 * @param {DayEntry[]} entries already filtered by type
 * @param {number} anchor the showing month's anchor day index
 * @param {number} cursor the entry-day being stepped from
 * @param {number} direction +1 forwards, -1 backwards
 * @returns {{ anchor: number, day: number | null }}
 */
export const stepAgendaDay = (entries, anchor, cursor, direction) => {
  const { year, month } = searchMonthOf(anchor, cursor, direction);
  const within = entryDaysIn(entries, year, month).filter((index) =>
    direction > 0 ? index > cursor : index < cursor,
  );
  // The nearest one in the direction of travel: the first ahead, the last behind.
  const near = direction > 0 ? within[0] : within[within.length - 1];
  if (near !== undefined) return { anchor: near, day: near };

  let scan = { year, month };
  for (let hop = 0; hop < AGENDA_SCAN_MONTHS; hop += 1) {
    scan = addMonths(scan.year, scan.month, direction);
    const days = entryDaysIn(entries, scan.year, scan.month);
    const land = direction > 0 ? days[0] : days[days.length - 1];
    if (land !== undefined) return { anchor: land, day: land };
  }

  return { anchor: monthStep(anchor, direction), day: null };
};

/**
 * Greedy interval layout: place each item in the first **lane** (column, in
 * Week; row-stack, in Date-spine) whose previous occupant has already ended,
 * opening a new lane only when every existing one is still busy. Items are
 * visited in start order, ties keeping input order — so simultaneous entries
 * never reorder by anything, magnitude least of all (ADR-0009 §5). Returns each
 * item with its `lane` and the total `lanes` the set needed, which is what a
 * renderer turns into a width or an offset.
 *
 * @template T
 * @param {T[]} items
 * @param {(item: T) => number} startOf
 * @param {(item: T) => number} endOf
 * @returns {{ item: T, lane: number, lanes: number }[]}
 */
export const assignLanes = (items, startOf, endOf) => {
  const ordered = items
    .map((item, order) => ({ item, order }))
    .sort((a, b) => startOf(a.item) - startOf(b.item) || a.order - b.order);

  /** @type {number[]} the end value currently occupying each lane */
  const laneEnds = [];
  const placed = ordered.map(({ item }) => {
    let lane = laneEnds.findIndex((end) => end <= startOf(item));
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(endOf(item));
    } else {
      laneEnds[lane] = endOf(item);
    }
    return { item, lane };
  });

  const lanes = laneEnds.length;
  return placed.map((p) => ({ ...p, lanes }));
};

/**
 * Lay Week's all-day band out: which entries get a lane, and which collapse
 * behind the overflow door (#81).
 *
 * Two things the band does that {@link assignLanes} deliberately does not:
 *
 * 1. **Inclusive ends.** `assignLanes` is half-open — a lane frees at the value
 *    its occupant ended on, which is right for the spine's day-values and the
 *    timed columns' minutes, and both callers keep that contract. An all-day
 *    range is not half-open: an entry running 20–22 July *occupies* the 22nd, so
 *    one starting on the 22nd shares a day with it and must not share its lane.
 *    The band converts inclusive to exclusive at the call — `endIndex + 1` — so
 *    the packer's "strictly after" test means what the band needs. The band is
 *    still **drawn** from `startIndex` to `endIndex`.
 * 2. **A fixed height.** The band reserves {@link WEEK_BAND_LANES} lanes whatever
 *    the week holds. Past them the entries collapse into a `+N more` that spends
 *    the last reserved lane itself — {@link rowsForEntries}, the same rule a
 *    Month cell's cap follows, so an overflowing week is never taller than one
 *    that merely fills the band.
 *
 * @template {{ startIndex: number, endIndex: number }} T
 * @param {T[]} multiDay
 * @returns {{ shown: { item: T, lane: number }[], hidden: T[] }}
 */
export const packAllDayBand = (multiDay) => {
  const laid = assignLanes(multiDay, (e) => e.startIndex, (e) => e.endIndex + 1);
  // `lanes` is the packer's own count of what the set needed — the same number
  // for every placed item, and nothing to re-derive here.
  const cap = rowsForEntries(laid[0]?.lanes ?? 0, WEEK_BAND_LANES);
  return {
    shown: laid.filter((x) => x.lane < cap).map(({ item, lane }) => ({ item, lane })),
    hidden: laid.filter((x) => x.lane >= cap).map((x) => x.item),
  };
};

/** @param {number} value @returns {string} */
const pad2 = (value) => String(value).padStart(2, "0");

/**
 * The `data-day` handle every view labels its day node with — the month cell,
 * the week header and column, the agenda row, the spine row. One function
 * because it is also read back by the scroll-to-today jump (#73): the five
 * writers and the one reader have to agree on the shape, whichever view is
 * showing.
 * @param {{ year: number, month: number, day: number }} civil @returns {string}
 */
const dayAttrOf = ({ year, month, day }) => `${year}-${pad2(month)}-${pad2(day)}`;

/**
 * Mount the calendar into `root`, reading the clock from `now`. The page is
 * driven almost entirely through the controls it renders (filter, prev, today,
 * next), which is what a test drives too; the one exception is the returned
 * `drillToAgendaDay`, a **jump** whose target is only known outside the mount.
 *
 * **Three hosts**, because the page chrome brackets the calendar above and
 * below: the controls render into `options.topbar` — the page's sticky
 * `<header>` (#73), which already holds the static h1 — everything that scrolls
 * under it renders into `root`, and the per-source freshness disclosure renders
 * into `options.freshness`, the slot the methodology footer keeps for it (#79,
 * ADR-0014 §2). All three are the page's to supply, not the module's to invent:
 * the h1 and the notes are static markup, and chrome the module built for
 * itself would be a second layout nothing ships. What the module still owns is
 * what the disclosure *says* — computed here, in the browser, against the
 * injected clock.
 *
 * @param {Element} root
 * @param {SitePayload} payload
 * @param {Date} now
 * @param {MountOptions} options the page-supplied hosts: the pinned topbar and the footer's freshness slot
 * @returns {{ drillToAgendaDay: (index: number) => void }}
 */
export const mountCalendar = (root, payload, now, options) => {
  const doc = root.ownerDocument;
  if (!doc) throw new Error("mountCalendar needs a root attached to a document.");

  const entries = normalizeEntries(payload);
  const todayKey = sgtDayKey(now);
  const todayIndex = sgtDayIndex(now);

  // The whole navigation state is **one anchor day**, plus the view and the
  // filter. Each view derives its own window from that single anchor — Month and
  // Agenda/Date-spine show the anchor's month, Week the anchor's week — so
  // switching view keeps position without any per-view cursor to reconcile
  // (AC 6), and the filter, applied once here, persists across every switch
  // (AC 5).
  // `agendaDay` is the one thing the anchor cannot say on its own: the
  // **entry-day** Agenda is stepping through (#77). It is seeded from today,
  // re-seeded by Today and by a drill-through, and it is what Next/Prev move
  // from — the anchor only ever names the month a surface draws.
  /** @type {{ view: View, anchor: number, filter: Filter, agendaDay: number }} */
  const state = { view: "month", anchor: todayIndex, filter: "all", agendaDay: todayIndex };

  /** @param {string} tag @param {string} [className] @param {string} [text] */
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /**
   * The date-number node for a day (#71): today's is a solid red disc with a
   * white numeral — the single "today" signal in every view — and any other
   * day's keeps its view's own number class. `small` selects the compact disc
   * the Week header needs so its day row does not distort. Nothing else marks
   * today, so no cell, column, or row is tinted merely because today falls in it.
   * @param {number} day @param {boolean} isToday @param {string | null} baseClass @param {boolean} [small]
   */
  const dayNumberNode = (day, isToday, baseClass, small = false) =>
    isToday
      ? el("span", small ? "disc disc--sm" : "disc", String(day))
      : el("span", baseClass ?? undefined, String(day));

  /**
   * The month-boundary label beside the numeral on the **1st** — Apple's
   * convention (#72), in Month's date row and in the Week header (#78). One
   * function for both, because the label's size is explicit in the CSS to stop
   * the Week cell inflating it, and a second call site drawing its own span is
   * how that quietly stops being true.
   * @param {number} month 1–12 @returns {HTMLElement}
   */
  const monthNameNode = (month) =>
    el("span", "calendar__monthname", MONTHS_SHORT[month - 1] ?? "");

  // --- The two hosts: the pinned header, and what scrolls under it --------
  root.textContent = "";
  root.className = "calendar";

  // Read defensively: the types say `topbar` is required, but this module is
  // shipped as plain JS to a browser, where nothing enforces that at the call.
  const topbar = options?.topbar;
  if (!topbar) throw new Error("mountCalendar needs the page's topbar to render its controls into.");
  const freshnessHost = options?.freshness;
  if (!freshnessHost) {
    throw new Error("mountCalendar needs the methodology footer's slot to render the freshness disclosure into.");
  }
  // A second mount into the same shell replaces the controls rather than
  // stacking a second set beside them — `root` is cleared above, but a
  // page-supplied topbar outlives the mount.
  for (const stale of Array.from(topbar.querySelectorAll(".calendar__controls"))) stale.remove();
  /** The controls, rebuilt each render: they carry the current view and title. */
  const controls = el("div", "calendar__controls");
  topbar.appendChild(controls);

  /** The showing view. Everything here scrolls under the pinned header. */
  const surface = el("div", "calendar__surface");

  /**
   * The day to bring to the **top of the viewport** after the next render, or
   * `null` to leave the scroll where the reader put it. Seeded with today, so
   * first load lands on the present the same way the Today control does (#73) —
   * the rule is applied after every render, not special-cased into one button.
   * @type {number | null}
   */
  let scrollTarget = todayIndex;

  /**
   * Land on an entry-day in Agenda: the day becomes both the anchor (so the
   * surface draws that day's month) and the cursor the next step moves from, and
   * it comes to the top of the viewport the same way the Today jump does (#73).
   * @param {number} index
   */
  const goToAgendaDay = (index) => {
    state.anchor = index;
    state.agendaDay = index;
    scrollTarget = index;
  };

  /**
   * The drill-through into Agenda (#77): switch surface, seed the cursor on the
   * day, bring it to the top. Month's and Week's `+N more` controls are its
   * consumers (#80, #81) — the collapse hands the reader to the reading surface
   * at the day they were looking at, rather than dead-ending in a count.
   * @param {number} index the day index to open Agenda on
   */
  const drillToAgendaDay = (index) => {
    state.view = "agenda";
    goToAgendaDay(index);
    render();
  };

  /**
   * Agenda steps by the **entry-day**, not the month (#77): it lists only the
   * days that have entries, so a month step there jumps over whole screens of
   * nothing and often lands on an empty one. {@link stepAgendaDay} finds the next
   * or previous day the surface actually draws — rolling into the adjacent months
   * at the edges, and degrading to a month step when the dataset has nothing that
   * way, so Next/Prev always move.
   * @param {number} delta
   */
  const stepAgenda = (delta) => {
    const { anchor, day } = stepAgendaDay(
      filterEntries(entries, state.filter),
      state.anchor,
      state.agendaDay,
      delta,
    );
    if (day === null) {
      // Nothing to land on, so nothing to scroll to. The cursor still follows the
      // month step: leaving it behind would make the next press step backwards
      // over ground the reader has already covered.
      state.anchor = anchor;
      state.agendaDay = anchor;
    } else {
      goToAgendaDay(day);
    }
    render();
  };

  /**
   * Page by the current view's unit: Agenda moves by the entry-day, Week moves
   * the anchor a whole week, Month and Date-spine a whole {@link monthStep}.
   * Month-paging deliberately leaves `scrollTarget` alone: the reader just moved
   * on purpose, and yanking them back to today would undo it. Agenda is the
   * exception — the day it steps to *is* where it means to put them.
   * @param {number} delta
   */
  const step = (delta) => {
    if (state.view === "agenda") {
      stepAgenda(delta);
      return;
    }
    state.anchor = state.view === "week" ? state.anchor + delta * 7 : monthStep(state.anchor, delta);
    render();
  };

  /** The nav title for the current view. @returns {string} */
  const titleText = () => {
    const { year, month } = civilOf(state.anchor);
    if (state.view !== "week") return `${MONTHS[month - 1]} ${year}`;

    const weekStart = mondayOf(state.anchor);
    const a = civilOf(weekStart);
    const b = civilOf(weekStart + 6);
    return a.month === b.month
      ? `${a.day} – ${b.day} ${MONTHS_SHORT[b.month - 1]} ${b.year}`
      : `${a.day} ${MONTHS_SHORT[a.month - 1]} – ${b.day} ${MONTHS_SHORT[b.month - 1]} ${b.year}`;
  };

  /**
   * The per-source freshness disclosure (#40) — present in every view, because it
   * is the page's role as the only always-true proof the pipeline ran. #79 narrows
   * *always visible* to **disclosed, not surfaced** (ADR-0014 §2): the mechanism is
   * untouched and only its place on the page changes, from under the header to the
   * methodology footer. One line per source, its elapsed lag computed here from the
   * baked instant and the injected `now`; a source two days or more stale escalates
   * to a prominent warning. The unit is the source, never a record (ADR-0004).
   * @returns {HTMLElement | null}
   */
  const renderFreshness = () => {
    const sources = payload.sources ?? [];
    if (!sources.length) return null;

    const list = el("div", "calendar__freshness");
    // A live region: a screen reader hears the freshness, and the warning, without
    // the reader having to go looking for the one line that says the page is stale.
    list.setAttribute("role", "status");
    for (const { source, lastConfirmed } of sources) {
      const { text, stale } = freshness(lastConfirmed, now);
      const item = el("div", "calendar__freshness-item");
      item.dataset["source"] = source;
      if (stale) item.classList.add("calendar__freshness-item--stale");
      item.appendChild(el("span", "calendar__freshness-source", source));
      item.appendChild(el("span", "calendar__freshness-ago", `last confirmed ${text}`));
      // The escalation is a distinct element, not just a colour: the warning has to
      // survive a reader who cannot tell calm from alarmed by hue alone.
      if (stale) item.appendChild(el("span", "calendar__freshness-warn", "⚠ pipeline may be stalled"));
      list.appendChild(item);
    }
    return list;
  };

  /**
   * Bring the pending `scrollTarget` day to the **top of the viewport** (#73).
   * The pinned header would otherwise cover it, so the shell's
   * `scroll-padding-top: var(--topbar-h)` pushes the landing below the header —
   * which is why {@link publishTopbarHeight} runs first, every render.
   *
   * A day the showing view does not render (today, while the reader is two
   * months back) falls back to the top of the surface rather than leaving them
   * stranded mid-scroll. `scrollIntoView` is absent in jsdom, which has no
   * layout at all, so the call is guarded and a test asserts only which element
   * was asked to come up.
   */
  const applyScrollTarget = () => {
    if (scrollTarget === null) return;
    const attr = dayAttrOf(civilOf(scrollTarget));
    const target = surface.querySelector(`[data-day="${attr}"]`) ?? surface;
    scrollTarget = null;
    if (typeof target.scrollIntoView === "function") target.scrollIntoView({ block: "start" });
  };

  /**
   * Publish the pinned header's **measured** height as `--topbar-h`, which the
   * shell's `scroll-padding-top` consumes. Measured rather than declared because
   * the header wraps to two, three or four lines depending on the viewport, and
   * a stale constant would land a jumped-to row behind it (#73).
   */
  const publishTopbarHeight = () => {
    // A remount leaves the previous mount's resize listener alive, holding a
    // header no longer in the page. It must not publish a detached header's
    // height over the live one's.
    if (!topbar.isConnected) return;
    if (typeof topbar.getBoundingClientRect !== "function") return;
    const { height } = topbar.getBoundingClientRect();
    doc.documentElement.style.setProperty("--topbar-h", `${height}px`);
  };

  /**
   * What a viewport resize invalidates, in **one** listener per mount. A resize
   * is the one thing that re-wraps the header without re-rendering it, and a
   * stale `--topbar-h` lands the next jump behind the header — the exact failure
   * the measurement exists to prevent (#73). It also moves every surface under
   * an open detail bubble, whose tail is pinned to viewport coordinates the
   * relayout has just invalidated, so the bubble closes first (#75).
   *
   * Having noticed its header is gone, it retires itself rather than firing for
   * the life of the page (#84). Self-eviction over a teardown function returned
   * from `mountCalendar`: the mount's contract stays "the page is driven
   * entirely through the controls it renders", needing no cooperation from a
   * caller who would have to remember to call it. Two costs. A stale handler
   * survives until the first resize after its header leaves — one no-op run,
   * which is what the guard inside was already doing. And stale here means
   * *detached*, not *superseded*: a remount into the very same header element
   * leaves both handlers live and publishing the same height, harmless but not
   * evicted.
   */
  const onResize = () => {
    // The bubble closes before the staleness check, not after it. A bubble hangs
    // off the document body, not off the mount's root, so a retired mount's
    // bubble outlives the surface it points at — and a handler that returned
    // early would leave it stranded in the page with nothing left to dismiss it.
    closeBubble();
    if (!topbar.isConnected) {
      doc.defaultView?.removeEventListener("resize", onResize);
      return;
    }
    publishTopbarHeight();
  };

  // The window is reached through the injected document, never a global.
  doc.defaultView?.addEventListener("resize", onResize);

  const render = () => {
    // --- Controls: view switcher, type filter, navigation ----------------
    // Two lines in the pinned header: the period and its stepper above, the
    // view tabs and the type filter below.
    controls.textContent = "";
    const periodBar = el("div", "calendar__bar");
    const viewBar = el("div", "calendar__bar");

    // Every view is present as a tab, so any one is reachable from any other in
    // a single click — the switching *is* the feature, not a fallback (§1).
    const views = el("div", "calendar__views");
    views.setAttribute("role", "tablist");
    for (const [value, label] of /** @type {[View, string][]} */ ([
      ["month", "Month"],
      ["week", "Week"],
      ["agenda", "Agenda"],
      ["spine", "Date-spine"],
    ])) {
      const button = /** @type {HTMLButtonElement} */ (el("button", "calendar__viewbtn", label));
      button.type = "button";
      button.dataset["view"] = value;
      button.setAttribute("role", "tab");
      const active = value === state.view;
      button.setAttribute("aria-selected", String(active));
      if (active) button.classList.add("calendar__viewbtn--active");
      button.addEventListener("click", () => {
        state.view = value;
        // Whichever surface the reader lands on opens on the present, not
        // wherever the last one happened to be scrolled to (#73). Only the
        // *scroll* is reset, not the anchor: a reader who paged to June and
        // switched view is still reading June (§6), and today's row simply is
        // not on that surface to scroll to. Agenda's cursor comes home with the
        // scroll, so a step after the switch reads from the present too (#77).
        scrollTarget = todayIndex;
        state.agendaDay = todayIndex;
        render();
      });
      views.appendChild(button);
    }

    const filter = /** @type {HTMLSelectElement} */ (el("select", "calendar__filter"));
    filter.setAttribute("aria-label", "Filter by type");
    for (const [value, label] of /** @type {[Filter, string][]} */ ([
      ["all", "All"],
      ["VenueEvent", "Venue events"],
      ["PortCall", "Port calls"],
    ])) {
      const option = /** @type {HTMLOptionElement} */ (el("option", undefined, label));
      option.value = value;
      if (value === state.filter) option.selected = true;
      filter.appendChild(option);
    }
    filter.addEventListener("change", () => {
      state.filter = /** @type {Filter} */ (filter.value);
      render();
    });

    const nav = el("div", "calendar__nav");
    /** @param {string} which @param {string} label @param {() => void} onClick */
    const navButton = (which, label, onClick) => {
      const button = /** @type {HTMLButtonElement} */ (el("button", "calendar__navbtn", label));
      button.type = "button";
      button.dataset["nav"] = which;
      button.addEventListener("click", onClick);
      return button;
    };
    const title = el("span", "calendar__title", titleText());

    nav.appendChild(navButton("prev", "‹ Prev", () => step(-1)));
    // Today returns to the present from anywhere — and the anchor is *reset*, not
    // stepped, so it lands home regardless of how far the reader wandered. It
    // also brings today's row to the top, which is the same rule every render
    // applies, not a behaviour special to this button.
    nav.appendChild(navButton("today", "Today", () => {
      state.anchor = todayIndex;
      state.agendaDay = todayIndex;
      scrollTarget = todayIndex;
      render();
    }));
    nav.appendChild(navButton("next", "Next ›", () => step(1)));

    periodBar.appendChild(title);
    periodBar.appendChild(nav);
    viewBar.appendChild(views);
    viewBar.appendChild(filter);
    controls.appendChild(periodBar);
    controls.appendChild(viewBar);

    // The one place the filter is applied — every view reads this same list (§4).
    const visible = filterEntries(entries, state.filter);
    surface.textContent = "";
    surface.appendChild(
      state.view === "week" ? renderWeek(visible)
      : state.view === "agenda" ? renderAgenda(visible)
      : state.view === "spine" ? renderSpine(visible)
      : renderMonth(visible),
    );

    // The header is pinned, so its height has to be republished before anything
    // scrolls to a row under it — the controls just changed, and on a narrow
    // viewport that changes how many lines they wrap to.
    publishTopbarHeight();
    applyScrollTarget();
  };

  // --- Month: the navigator ----------------------------------------------
  /** @param {DayEntry[]} visible @returns {HTMLElement} */
  const renderMonth = (visible) => {
    const { year, month } = civilOf(state.anchor);
    const cells = monthGridCells(year, month, todayKey);

    const grid = el("div", "calendar__grid");

    const head = el("div", "calendar__weekdays");
    for (const label of WEEKDAYS) {
      const column = el("span", "calendar__weekday", label);
      if (WEEKEND_LABELS.has(label)) column.classList.add("is-weekend");
      head.appendChild(column);
    }
    grid.appendChild(head);

    const body = el("div", "calendar__weeks");
    for (const cell of cells) {
      const dayNode = el("div", "calendar__day");
      if (!cell.inMonth) dayNode.classList.add("calendar__day--outside");
      // The weekend wash (#72), marked by what the day *is*. It runs through the
      // outside-month days unbroken — they carry no wash of their own and recede
      // by fading their contents instead — so grey means exactly one thing in
      // this grid: weekend.
      if (cell.isWeekend) dayNode.classList.add("is-weekend");
      dayNode.dataset["day"] = dayAttrOf(cell);

      // The date row: the numeral, and on the 1st the month it opens. A leading
      // or trailing row would otherwise be an unlabelled run of numbers, now that
      // no wash distinguishes it (Apple's convention, #72).
      const date = el("div", "calendar__date");
      // The numeral needs no class of its own: the row above carries Month's date
      // type scale, and today's disc brings its own.
      date.appendChild(dayNumberNode(cell.day, cell.isToday, null));
      if (cell.day === 1) date.appendChild(monthNameNode(cell.month));
      dayNode.appendChild(date);

      // Month is fixed to one screen (ADR-0014 §1): chips are one line and capped
      // per day, and the overflow past the cap collapses to a `+N more` that
      // drills into that day in Agenda. The control spends one of the cell's
      // {@link MONTH_CELL_ROWS} rows, so an overflowing day shows one chip fewer —
      // it is never taller than a day that simply fills the cell.
      //
      // This is not the density inversion #5 disqualified. #5 ruled out `+N more`
      // as a **dead-end popover** on a grid asked to *read* magnitude; here the
      // grid is the navigator (ADR-0009 §2), the inversion stays mitigated
      // structurally by Date-spine and Agenda (ADR-0009 §5), and the overflow
      // hands the reader to a reading surface at the day they were looking at
      // rather than hiding entries behind a count.
      const onDay = entriesOnDay(visible, cell.key);
      const cap = rowsForEntries(onDay.length, MONTH_CELL_ROWS);
      for (const entry of onDay.slice(0, cap)) dayNode.appendChild(renderChip(entry));

      const hidden = onDay.length - cap;
      if (hidden > 0) {
        const index = dayIndexOf(cell.year, cell.month, cell.day);
        dayNode.appendChild(moreButton("calendar__more", hidden, index));
      }
      body.appendChild(dayNode);
    }
    grid.appendChild(body);
    return grid;
  };

  // --- Week: the working week, hour by hour, in published clock time -----
  /** @param {DayEntry[]} visible @returns {HTMLElement} */
  const renderWeek = (visible) => {
    const weekStart = mondayOf(state.anchor);
    const weekEnd = weekStart + 6;
    const days = weekDaysOf(state.anchor, todayIndex);
    const wrap = el("div", "week");

    // Column headers: Mon–Sun with each day's date, and on the 1st the month it
    // opens — Apple's convention, the same one Month follows (#72). The row is
    // held to a fixed height and centred in CSS, so neither the today disc nor
    // that label can grow it and knock the day row out of alignment (#78).
    const head = el("div", "week__head");
    head.appendChild(el("span", "week__corner"));
    days.forEach((d, i) => {
      const cell = el("div", "week__day");
      cell.dataset["day"] = dayAttrOf(d);
      // The weekend wash, marked by what the day *is* (#72, #78). In Week the
      // wash is a property of the **column**, so the same class is put on the
      // hour column below and the band paints the matching two sevenths — one
      // grey running the full height of the view, not three unrelated stripes.
      if (d.isWeekend) cell.classList.add("is-weekend");
      cell.appendChild(el("span", "week__dayname", WEEKDAYS[i] ?? ""));
      cell.appendChild(dayNumberNode(d.day, d.isToday, "week__daynum", true));
      if (d.day === 1) cell.appendChild(monthNameNode(d.month));
      head.appendChild(cell);
    });
    wrap.appendChild(head);

    // The all-day band: a multi-day entry has no single hour, so it rides a band
    // spanning the columns it covers (ADR-0009 §3), stacked into lanes where two
    // bands share a day. {@link packAllDayBand} owns both rules the band does not
    // share with the hour grid — inclusive ends, and a reserved height — so this
    // renderer only draws what it is handed.
    //
    // The band is drawn even when the week has nothing on it: an empty band that
    // holds its height is the point of the reservation, and a band that vanished
    // would move the hour grid every time the reader paged past a quiet week.
    const multiDay = visible.filter(
      (e) => e.startIndex !== e.endIndex && e.endIndex >= weekStart && e.startIndex <= weekEnd,
    );
    const { shown, hidden } = packAllDayBand(multiDay);
    const band = el("div", "week__allday");
    band.appendChild(el("span", "week__corner", "All-day"));
    const bandGrid = el("div", "week__band-grid");
    // The reservation is published to the CSS rather than duplicated in it, so
    // the lane count the packer enforces and the rows the band draws cannot drift.
    bandGrid.style.setProperty("--band-lanes", String(WEEK_BAND_LANES));
    for (const { item, lane } of shown) {
      const leftCol = Math.max(item.startIndex, weekStart) - weekStart;
      const rightCol = Math.min(item.endIndex, weekEnd) - weekStart;
      const node = renderBand(item);
      node.style.gridColumn = `${leftCol + 1} / ${rightCol + 2}`;
      node.style.gridRow = String(lane + 1);
      bandGrid.appendChild(node);
    }
    if (hidden.length) {
      // The same door Month's cell opens (#80): the overflow hands the reader to
      // Agenda rather than dead-ending in a count. It aims at the **earliest
      // hidden entry's day** — where the entries the band could not fit actually
      // begin, which is deliberately not clamped to the showing week: a band
      // running into this week from the last one is read from its own first day,
      // and Agenda draws it under every day it spans anyway.
      const earliest = Math.min(...hidden.map((e) => e.startIndex));
      const more = moreButton("week__band week__band--more", hidden.length, earliest);
      more.style.gridColumn = "1 / -1";
      more.style.gridRow = String(WEEK_BAND_LANES);
      bandGrid.appendChild(more);
    }
    band.appendChild(bandGrid);
    wrap.appendChild(band);

    // The hour grid: a gutter of hour marks, then one column per day with each
    // single-day entry positioned by its true published clock time. Overlapping
    // entries split the column into side-by-side lanes.
    const body = el("div", "week__grid");
    // The legibility marks (#78): faint hairlines quartering the day at 06:00,
    // 12:00 and 18:00, so an entry's time reads off its vertical position
    // instead of being counted down from the gutter. They are absolutely
    // positioned, so they are out of the grid's flow and start after the hour
    // gutter; appended **first**, so the columns' wash and the entries
    // positioned inside them both paint over the guide rather than under it.
    // The day's opening 00:00 line is the all-day band's bottom border and its
    // closing 24:00 line is the grid's own, so the four quarters are enclosed.
    for (const percentDownTheDay of [25, 50, 75]) {
      const line = el("div", "week__hline");
      line.style.top = `${percentDownTheDay}%`;
      body.appendChild(line);
    }
    const gutter = el("div", "week__gutter");
    for (let hour = 0; hour < 24; hour += 3) {
      const mark = el("span", "week__hour", `${pad2(hour)}:00`);
      mark.style.top = `${(hour / 24) * 100}%`;
      gutter.appendChild(mark);
    }
    body.appendChild(gutter);

    for (const d of days) {
      const col = el("div", "week__col");
      col.dataset["day"] = dayAttrOf(d);
      if (d.isWeekend) col.classList.add("is-weekend");
      const timed = visible.filter((e) => e.startIndex === e.endIndex && e.startIndex === d.index);
      const laid = assignLanes(
        timed,
        (e) => sgtMinutesOfDay(new Date(e.start)),
        (e) => sgtMinutesOfDay(new Date(e.end)),
      );
      for (const { item, lane, lanes } of laid) {
        const startMin = sgtMinutesOfDay(new Date(item.start));
        const endMin = sgtMinutesOfDay(new Date(item.end));
        const node = renderEntry(item, `${clockText(item.start)}–${clockText(item.end)}`);
        node.classList.add("week__event");
        node.style.top = `${(startMin / 1440) * 100}%`;
        node.style.height = `${Math.max(((endMin - startMin) / 1440) * 100, 2)}%`;
        node.style.left = `${(lane / lanes) * 100}%`;
        node.style.width = `${(1 / lanes) * 100}%`;
        col.appendChild(node);
      }
      body.appendChild(col);
    }
    wrap.appendChild(body);
    return wrap;
  };

  // --- Agenda: every entry named, with where and when --------------------
  /** @param {DayEntry[]} visible @returns {HTMLElement} */
  const renderAgenda = (visible) => {
    const { year, month } = civilOf(state.anchor);
    const list = el("div", "agenda");
    // The same day list Next/Prev steps along (#77), so the surface and the
    // stepper cannot disagree about which days are here.
    const days = entryDaysIn(visible, year, month);
    for (const index of days) {
      const { day } = civilOf(index);
      const onDay = entriesOnDay(visible, dayKey(year, month, day));
      const dayNode = el("div", "agenda__day");
      dayNode.dataset["day"] = dayAttrOf({ year, month, day });
      // Weekday and month sit either side of the date number, so today's disc
      // rides the number alone rather than washing the whole label.
      const date = el("span", "agenda__date");
      date.appendChild(el("span", undefined, weekdayLabel(index)));
      date.appendChild(dayNumberNode(day, index === todayIndex, null));
      date.appendChild(el("span", undefined, MONTHS_SHORT[month - 1] ?? ""));
      dayNode.appendChild(date);
      const items = el("div", "agenda__items");
      // `entriesOnDay` repeats a multi-day entry under each day it spans, so a
      // congress appears on each of its days here — as it should (§3).
      for (const entry of onDay) items.appendChild(renderEntry(entry, clockText(entry.start)));
      dayNode.appendChild(items);
      list.appendChild(dayNode);
    }
    if (!days.length) list.appendChild(el("p", "agenda__empty", "No entries this month."));
    return list;
  };

  // --- Date-spine: duration as literal span ------------------------------
  /** @param {DayEntry[]} visible @returns {HTMLElement} */
  const renderSpine = (visible) => {
    const { year, month } = civilOf(state.anchor);
    const daysInMonth = monthLength(year, month);
    const monthStart = dayIndexOf(year, month, 1);
    const monthEnd = monthStart + daysInMonth; // exclusive
    const span = daysInMonth;
    /**
     * Where a day index sits down the track, as a percentage of the month. The
     * bars and the week-boundary lines share it, so a line cannot land on a
     * row's edge that the bars measure from somewhere else.
     * @param {number} value @returns {string}
     */
    const topOf = (value) => `${((value - monthStart) / span) * 100}%`;

    const wrap = el("div", "spine");
    // The month's length, handed to the stylesheet: the track is exactly as tall
    // as the axis is long, so one percentage names one row on both (#74).
    wrap.style.setProperty("--spine-days", String(daysInMonth));

    const axis = el("div", "spine__axis");
    for (let day = 1; day <= daysInMonth; day += 1) {
      const index = dayIndexOf(year, month, day);
      const row = el("div", "spine__date");
      row.dataset["day"] = dayAttrOf({ year, month, day });
      row.appendChild(el("span", "spine__dayname", weekdayLabel(index)));
      row.appendChild(dayNumberNode(day, index === todayIndex, "spine__datenum", true));
      axis.appendChild(row);
    }
    wrap.appendChild(axis);

    // Each entry is a vertical bar whose **height is its duration**, so a
    // multi-day congress physically dominates a three-hour fair. Span standing
    // in for magnitude is the whole point of this view (ADR-0009 §3/§5) — it is
    // still not a score: nothing is ranked, only measured against the clock.
    const track = el("div", "spine__track");

    // The **week-boundary line** (#74): a rule at the top of each Monday's row,
    // spanning the axis as well as the track (the stylesheet reaches it back
    // across both widths), so a column of floating bars reads one week at a time
    // rather than as one undifferentiated run of durations. Drawn before the bars,
    // so an entry paints over the line rather than the line across the entry.
    // Monday is `mondayOf(index) === index` — the same single fact Week's
    // geometry and every weekday label read from, so Date-spine and Week can
    // never disagree about where a week starts.
    for (let day = 1; day <= daysInMonth; day += 1) {
      const index = dayIndexOf(year, month, day);
      if (mondayOf(index) !== index) continue;
      const line = el("div", "spine__week");
      line.dataset["day"] = dayAttrOf({ year, month, day });
      line.style.top = topOf(index);
      track.appendChild(line);
    }

    const inMonth = visible.filter((e) => e.endValue > monthStart && e.startValue < monthEnd);
    for (const { item, lane, lanes } of assignLanes(inMonth, (e) => e.startValue, (e) => e.endValue)) {
      const start = Math.max(item.startValue, monthStart);
      const end = Math.min(item.endValue, monthEnd);
      const node = renderEntry(item, spanText(item.endValue - item.startValue));
      node.classList.add("spine__bar");
      node.style.top = topOf(start);
      node.style.height = `${Math.max(((end - start) / span) * 100, 0.8)}%`;
      node.style.left = `${(lane / lanes) * 100}%`;
      node.style.width = `${(1 / lanes) * 100}%`;
      track.appendChild(node);
    }
    wrap.appendChild(track);
    return wrap;
  };

  /**
   * Month's **chip**: one entry, one line, truncated with an ellipsis where the
   * cell is too narrow (#80). It carries the summary and nothing else — a chip
   * that stacked a location and a source line under it would be the full entry
   * again, and the cell height the cap buys would go straight back.
   *
   * What the line drops is on its `title`: the location, and — unlike every
   * reading surface — the source label #38 puts on an entry. Month is the
   * navigator; the attribution is one gesture away, on the Agenda `+N more`
   * hands the reader to and in the detail bubble a double-click on the chip
   * itself opens (#75).
   * The label drops a port call's `Cruise: ` prefix, as the prototype does. On a
   * chip roughly sixteen characters wide it is eight characters of constant, and
   * what it truncates is the vessel — the one thing that distinguishes one call
   * from another. ADR-0001 keeps that prose in `summary` because an iCal client
   * has nothing else to carry the category; the chip does — its type colour — and
   * the full summary survives on the `title` and on every reading surface.
   * @param {DayEntry} entry @returns {HTMLElement}
   */
  const renderChip = (entry) => renderLeaf(entry, "calendar__chip");

  /**
   * The **overflow door** both bounded surfaces open (#80, #81): the control a
   * cap or a reservation leaves behind, naming a destination rather than
   * dead-ending in a count. One function because the two surfaces must not
   * quietly diverge on what it says or where it goes — only on where it sits,
   * which the caller styles. It is a `button`, not a decorated `div`, because it
   * navigates and has to be reachable from the keyboard.
   * @param {string} className @param {number} hidden @param {number} index the day Agenda opens on
   * @returns {HTMLButtonElement}
   */
  const moreButton = (className, hidden, index) => {
    const node = /** @type {HTMLButtonElement} */ (el("button", className, `+${hidden} more →`));
    node.setAttribute("type", "button");
    node.addEventListener("click", () => drillToAgendaDay(index));
    return node;
  };

  /**
   * Week's **all-day band**: the same one-line leaf as {@link renderChip}, drawn
   * across the columns the entry spans (#81).
   *
   * It is one line for the reason the chip is: the band reserves a fixed number
   * of lanes so a quiet and a busy week share a height, and a lane can only be a
   * fixed height if what rides in it is a single line. So the band narrows #38's
   * "every entry is labelled with the source" exactly as the chip does — the
   * location and the source move to the `title`, one drill away on the reading
   * surface the band's `+N more` hands the reader to. The hour grid below it is
   * unaffected: a timed entry there is still the full {@link renderEntry}.
   * @param {DayEntry} entry @returns {HTMLElement}
   */
  const renderBand = (entry) => renderLeaf(entry, "week__band");

  /**
   * The one-line leaf both dense surfaces draw: the summary alone, its type
   * carried by colour, with what the line has no room for on its `title`. The
   * `Cruise: ` prefix is dropped because on a line this narrow it is eight
   * characters of constant crowding out the `vessel` — the one thing telling one
   * call from another (see {@link renderChip}).
   * @param {DayEntry} entry @param {string} className @returns {HTMLElement}
   */
  const renderLeaf = (entry, className) => {
    const node = el("div", className, entry.summary.replace(/^Cruise: /, ""));
    node.dataset["type"] = entry.type;
    node.title = entry.location ? `${entry.summary} — ${entry.location}` : entry.summary;
    bindBubble(node, entry);
    return node;
  };

  /**
   * One entry, rendered the same on every **reading** surface: type, an optional
   * time/duration label, the name, where, and the source that produced it.
   * `timeText` is the one thing that differs — the Week band omits it, the rest
   * supply it. Month draws {@link renderChip} instead, which is the whole
   * navigator/reading-surface split made visible.
   * @param {DayEntry} entry @param {string} [timeText]
   */
  const renderEntry = (entry, timeText) => {
    const node = el("div", "calendar__entry");
    node.dataset["type"] = entry.type;
    if (timeText) node.appendChild(el("span", "calendar__entry-time", timeText));
    // `summary` already names a port call's vessel and terminal, and a venue
    // event's name (the projection in `src/domain/project.ts`).
    node.appendChild(el("span", "calendar__entry-title", entry.summary));
    // The location carries a venue event's hall where published, and a port
    // call's terminal. Rendered only when non-empty.
    if (entry.location) node.appendChild(el("span", "calendar__entry-where", entry.location));
    // Every entry is labelled with the source that produced it (#38) — the
    // attribution that lets two labelled duplicates read as two, not one.
    node.appendChild(el("span", "calendar__source", entry.source));
    bindBubble(node, entry);
    return node;
  };

  /** `HH:MM` in Singapore time. @param {string} instant @returns {string} */
  const clockText = (instant) => {
    const minutes = sgtMinutesOfDay(new Date(instant));
    return `${pad2(Math.floor(minutes / 60))}:${pad2(minutes % 60)}`;
  };

  /**
   * A human duration for Date-spine's label — hours under a day, else days to
   * one decimal. The number the eye reads off the bar's height, spelled out.
   * @param {number} days @returns {string}
   */
  const spanText = (days) => {
    const hours = days * 24;
    if (hours < 24) return `${Math.max(1, Math.round(hours))} hr`;
    const rounded = Math.round(days * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)} days`;
  };

  // --- The entry-detail bubble (#75) --------------------------------------
  //
  // Double-clicking an entry on any view opens a small anchored popover showing
  // the few honest fields the at-rest surfaces truncate or hide — the chip's
  // ellipsised title, the location a leaf drops, the source a chip moves to its
  // tooltip. It is emphatically **not** more fields: the dataset is existence
  // and timing only (CONTEXT.md §CalendarEntry), so the bubble shows what is
  // there in full and invents nothing.
  //
  // The split below is the whole design. {@link buildBubble} is pure DOM from
  // one entry and is where every content decision lives, which is what makes it
  // testable at seam 3; {@link positionBubble} is geometry, measured against a
  // viewport jsdom does not have, and is deliberately the only part outside it.

  /**
   * Each source's baked last-confirmed instant, by source key — the same
   * `payload.sources` list {@link renderFreshness} reads, so the bubble's footer
   * and the page's disclosure can never disagree about when a source was last
   * seen. A source the payload says nothing about is simply absent from the map:
   * the bubble then names the attribution and claims no age for it, rather than
   * inventing one.
   */
  const lastConfirmedBySource = new Map(
    (payload.sources ?? []).map(({ source, lastConfirmed }) => [source, lastConfirmed]),
  );

  /**
   * The type, in the reader's words rather than the schema's. The glossary bans
   * a bare "event" (CONTEXT.md §Event) and the two types are what it bans it in
   * favour of — but a hotelier reads "Cruise arrival", not `PortCall`.
   * @param {DayEntry} entry @returns {string}
   */
  const typeLabel = (entry) => (entry.type === "PortCall" ? "Cruise arrival" : "Venue event");

  /**
   * `Fri 17 Jul` — a day named as a reader reads it, its year left to the caller.
   * @param {number} index @returns {string}
   */
  const dateText = (index) => {
    const { month, day } = civilOf(index);
    return `${weekdayLabel(index)} ${day} ${MONTHS_SHORT[month - 1] ?? ""}`;
  };

  /**
   * **When**: one day, or the range the entry spans — the year said once, at the
   * end, because a range inside one year does not need it twice.
   * @param {DayEntry} entry @returns {string}
   */
  const whenText = (entry) =>
    entry.startIndex === entry.endIndex
      ? `${dateText(entry.startIndex)} ${civilOf(entry.startIndex).year}`
      : `${dateText(entry.startIndex)} – ${dateText(entry.endIndex)} ${civilOf(entry.endIndex).year}`;

  /**
   * **Time**: the published clock times, SGT. The connector carries the fact the
   * dash cannot — a dash reads as "from … to" within one day, and an arrow says
   * the end time belongs to a *later* day.
   * @param {DayEntry} entry @returns {string}
   */
  const bubbleTimeText = (entry) =>
    `${clockText(entry.start)} ${entry.startIndex === entry.endIndex ? "–" : "→"} ${clockText(entry.end)} SGT`;

  /**
   * The freshness footer, for **this entry's own source** — computed here from
   * the baked instant and the injected clock, exactly as the page's disclosure
   * is (#40), never a baked relative string.
   * @param {DayEntry} entry @returns {string}
   */
  const bubbleFootText = (entry) => {
    const lastConfirmed = lastConfirmedBySource.get(entry.source);
    return lastConfirmed ? `${entry.source} · confirmed ${freshness(lastConfirmed, now).text}` : entry.source;
  };

  /**
   * The bubble, built from one entry: the bake-off's **variant E** — a type
   * accent band and colour chip carrying the clicked tile's own colour, over a
   * data-record grid, over the freshness footer.
   * @param {DayEntry} entry @returns {HTMLElement}
   */
  const buildBubble = (entry) => {
    const node = el("div", "calendar__bubble");
    // The accent and the chip dot read their colour off this, the same attribute
    // and the same two colours every surface's entry carries.
    node.dataset["type"] = entry.type;
    node.appendChild(el("div", "calendar__bubble-accent"));

    const pad = el("div", "calendar__bubble-pad");
    const chip = el("div", "calendar__bubble-chip");
    chip.appendChild(el("span", "calendar__bubble-dot"));
    chip.appendChild(el("span", undefined, typeLabel(entry)));
    pad.appendChild(chip);
    // The full title — the one thing every at-rest surface truncates. The
    // `Cruise: ` prefix goes for the reason a chip drops it: the chip above says
    // the type in words, so the prose prefix ADR-0001 keeps in `summary` for an
    // iCal client is redundant here.
    pad.appendChild(el("div", "calendar__bubble-title", entry.summary.replace(/^Cruise: /, "")));

    const grid = el("dl", "calendar__bubble-grid");
    /** @param {string} label @param {string} value */
    const put = (label, value) => {
      grid.appendChild(el("dt", undefined, label));
      grid.appendChild(el("dd", undefined, value));
    };
    put("When", whenText(entry));
    put("Time", bubbleTimeText(entry));
    // Always drawn, as variant E draws it. `CalendarEntry.location` is a
    // required string that `project` always composes — venue plus hall, or the
    // terminal — so a guard here would only ever fire on data the projection
    // cannot produce, at the cost of a record grid whose rows come and go.
    put("Where", entry.location);
    // The same {@link spanText} Date-spine labels its bars with, reused rather
    // than restated — a bar and its bubble rounding a duration differently is
    // the kind of drift two copies of one rule always produce.
    put("Length", spanText(entry.endValue - entry.startValue));
    pad.appendChild(grid);
    node.appendChild(pad);

    node.appendChild(el("div", "calendar__bubble-foot", bubbleFootText(entry)));
    return node;
  };

  /** Clear air between the anchor node and the bubble. */
  const BUBBLE_GAP = 10;
  /** The closest the bubble is allowed to come to a viewport edge. */
  const BUBBLE_MARGIN = 8;
  /** The tail's half-width — its `border-width` in the stylesheet. */
  const BUBBLE_TAIL = 9;
  /** How far in from the node's left edge the tail aims. */
  const BUBBLE_TAIL_INSET = 14;

  /**
   * Place the bubble against the node it was opened from, in **viewport
   * coordinates** (`position: fixed`): below by default, flipped above when it
   * would run off the bottom *and* there is room above, clamped horizontally
   * with the tail kept on the node.
   *
   * **This is the one part outside seam 3, and deliberately so** (#75). Every
   * number here comes from `getBoundingClientRect` and `offsetWidth` measured
   * against a viewport — and jsdom has no layout engine, so it answers zero to
   * all of them. The tests drive this function (an exception thrown here would
   * fail them) and assert only that a placement was applied; the flip, the clamp
   * and the tail offset are checked against the prototype by eye, as the rest of
   * round 1's geometry was.
   *
   * @param {HTMLElement} node the bubble @param {Element} anchor the node clicked
   */
  const positionBubble = (node, anchor) => {
    const rect = anchor.getBoundingClientRect();
    const view = doc.defaultView;
    const width = node.offsetWidth;
    const height = node.offsetHeight;
    const viewWidth = view?.innerWidth ?? 0;
    const viewHeight = view?.innerHeight ?? 0;

    let above = false;
    let top = rect.bottom + BUBBLE_GAP;
    // Flipped only when there is somewhere to flip *to*: a bubble moved above a
    // node it does not fit above either is no better placed than one that
    // overhangs the bottom.
    if (top + height + BUBBLE_MARGIN > viewHeight && rect.top - BUBBLE_GAP - height > BUBBLE_MARGIN) {
      above = true;
      top = rect.top - BUBBLE_GAP - height;
    }
    // The class picks which edge the tail hangs off, so the flip is one fact
    // stated once and the stylesheet draws both cases from it.
    node.classList.toggle("calendar__bubble--above", above);
    node.classList.toggle("calendar__bubble--below", !above);

    const left = Math.max(BUBBLE_MARGIN, Math.min(rect.left, viewWidth - width - BUBBLE_MARGIN));
    node.style.left = `${left}px`;
    node.style.top = `${top}px`;
    // The tail aims a little way in from the node's left edge, then is clamped
    // inside the bubble's own width — which is what keeps a bubble pushed off a
    // screen edge still visibly pointing at the entry it describes.
    const tailAt = Math.min(
      Math.max(rect.left + BUBBLE_TAIL_INSET, left + BUBBLE_TAIL_INSET),
      left + width - BUBBLE_TAIL_INSET,
    );
    node.style.setProperty("--tail-x", `${tailAt - left - BUBBLE_TAIL}px`);
  };

  /**
   * The one open bubble, or `null`. One at a time, page-wide: a second popover
   * beside the first has nothing to point at that the first does not.
   * @type {HTMLElement | null}
   */
  let openBubble = null;

  const closeBubble = () => {
    openBubble?.remove();
    openBubble = null;
  };

  /**
   * Build hidden, append, place, reveal. The order matters: a bubble revealed
   * before it is placed paints for a frame at the top-left corner of the
   * viewport, because that is where a `position: fixed` node with no offsets
   * sits. It hangs off the document body rather than the surface, so no
   * scrolling or `overflow: hidden` container can clip it.
   * @param {Element} anchor @param {DayEntry} entry
   */
  const openBubbleFor = (anchor, entry) => {
    closeBubble();
    const node = buildBubble(entry);
    node.style.visibility = "hidden";
    (doc.body ?? root).appendChild(node);
    positionBubble(node, anchor);
    node.style.visibility = "";
    openBubble = node;
  };

  /**
   * The double-click affordance on one entry node. It is bound by
   * {@link renderLeaf} and {@link renderEntry} — the two functions every view
   * draws an entry through — which is both how all five surfaces get it and how
   * the `+N more` doors are excluded without a rule saying so: a door is
   * neither, because it navigates rather than describing an entry.
   *
   * Double-click, not click: a single click is how a reader scans a chip-dense
   * Month, and a popover under every one of them would make the navigator
   * unusable. Two costs are accepted for this round rather than papered over —
   * the bubble has no keyboard opening, and a short timed Week entry is a small
   * target.
   * @param {Element} node @param {DayEntry} entry
   */
  const bindBubble = (node, entry) => {
    node.addEventListener("dblclick", (opened) => {
      // The innermost entry wins. No surface nests one entry node inside another
      // today, so this changes nothing yet — it is what keeps the affordance
      // meaning "the entry you pointed at" if one ever does.
      opened.stopPropagation();
      openBubbleFor(node, entry);
    });
  };

  /**
   * Binds one dismissal listener to a target that **outlives the mount** — the
   * document, the window. Each retires itself the first time it fires after its mount's
   * root has left the page, the same self-eviction the topbar's resize handler
   * does (#84): a remount would otherwise leave every previous mount's handlers
   * firing for the life of the page. Stale here means *detached*, not
   * *superseded*, with the same caveat #84 records — a remount into the very
   * same root leaves both live, closing the same bubble twice over, harmlessly.
   *
   * Retiring, it takes the bubble with it. The bubble hangs off the document
   * body rather than the root, so it survives its mount's removal; a listener
   * that evicted itself without closing would leave a popover in the page
   * pointing at a surface that has gone, and no path left to dismiss it.
   *
   * @param {EventTarget | null | undefined} target @param {string} type
   * @param {(fired: any) => void} handler @param {boolean} [capture]
   */
  const bindDismissal = (target, type, handler, capture = false) => {
    /** @param {any} fired */
    const listener = (fired) => {
      if (!root.isConnected) {
        closeBubble();
        target?.removeEventListener(type, listener, capture);
        return;
      }
      handler(fired);
    };
    target?.addEventListener(type, listener, capture);
  };

  // A click anywhere but inside the bubble dismisses it…
  bindDismissal(doc, "click", (clicked) => {
    if (openBubble && !openBubble.contains(clicked.target)) closeBubble();
  });
  // …as does Esc, which is how a keyboard reader gets out of it.
  bindDismissal(doc, "keydown", (pressed) => {
    if (pressed.key === "Escape") closeBubble();
  });
  // Any scroll, in **capture** phase: a scroll event does not bubble, so a
  // listener on the window only sees the page's own scrolling — and Week's grid
  // and Month's own scroller would slide out from under a bubble that stayed
  // fixed where it was. Accepted for this round (#75): the bubble closes on a
  // scroll rather than following its node.
  bindDismissal(doc.defaultView, "scroll", closeBubble, true);
  // A resize dismisses it too — through {@link onResize}, which is the mount's
  // one resize listener rather than a second one racing it.

  // The freshness disclosure is a property of the data behind every view, not of
  // the month or the week, so it is rendered once here rather than rebuilt by
  // every render. It lands in the methodology footer's slot rather than under
  // the header (#79, ADR-0014 §2) — **disclosed, not surfaced**: still present,
  // still computed here against the injected clock, so a frozen page still shows
  // a growing lag, and being outside the view surface is what keeps it visible
  // in all four views without a rerender. The slot is the page's and outlives
  // the mount, so a second mount replaces the disclosure the way the topbar
  // replaces its controls.
  for (const stale of Array.from(freshnessHost.querySelectorAll(".calendar__freshness"))) stale.remove();
  const fresh = renderFreshness();
  if (fresh) freshnessHost.appendChild(fresh);
  root.appendChild(surface);

  render();

  // The one handle the mount hands back: the page is still driven entirely
  // through the controls it renders, but a drill-through is a *jump*, and the
  // day it jumps to is only known outside — from the `+N more` that was clicked
  // (#80, #81), or from a test. `index.html` ignores this.
  return { drillToAgendaDay };
};
