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
 * "which days have demand?", lands on today, and drills nowhere yet — the three
 * reading surfaces are #39/#40. So there is deliberately **no magnitude here** —
 * no count badge, no `+N more` collapse, no ranking. Every entry on a day is
 * rendered; a busy day simply grows.
 *
 * Four switchable views (ADR-0009): **Month** navigates; **Week**, **Agenda**
 * and **Date-spine** are the reading surfaces this file adds in #39. No single
 * one is *the* view — reading demand from several angles is the feature. Still
 * **no magnitude** in any of them (ADR-0009 §5): span and names stand in for the
 * size the data does not carry, and nothing is ranked, scored or collapsed.
 *
 * @typedef {{ uid: string, summary: string, start: string, end: string, location: string, source: string }} SiteEntry
 * @typedef {{ source: string, lastConfirmed: string }} SourceFreshness
 * @typedef {{ venueEvents: SiteEntry[], portCalls: SiteEntry[], sources?: SourceFreshness[] }} SitePayload
 * @typedef {"VenueEvent" | "PortCall"} RecordType
 * @typedef {"all" | RecordType} Filter
 * @typedef {"month" | "week" | "agenda" | "spine"} View
 * @typedef {SiteEntry & { type: RecordType, startKey: number, endKey: number, startIndex: number, endIndex: number, startValue: number, endValue: number }} DayEntry
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
 * @param {number} year
 * @param {number} month  1–12
 * @param {number} todayKey
 * @returns {{ year: number, month: number, day: number, key: number, inMonth: boolean, isToday: boolean }[]}
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
    });
  }
  return cells;
};

/**
 * The seven days of the Monday-first week that contains `anchorIndex` (a
 * `sgtDayIndex`). Week paging works by moving the anchor ±7; the view always
 * shows the whole working-and-weekend week the anchor lands in.
 *
 * @param {number} anchorIndex
 * @param {number} todayIndex
 * @returns {{ year: number, month: number, day: number, index: number, key: number, isToday: boolean }[]}
 */
export const weekDaysOf = (anchorIndex, todayIndex) => {
  // 1970-01-01 (index 0) is a Thursday, three days after Monday, so
  // `(index + 3) % 7` is the day's distance back to Monday.
  const monday = anchorIndex - ((anchorIndex + 3) % 7);
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
    });
  }
  return days;
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

/** @param {number} value @returns {string} */
const pad2 = (value) => String(value).padStart(2, "0");

/**
 * Mount the calendar into `root`, reading the clock from `now`. Returns nothing:
 * the page is driven entirely through the controls it renders (filter, prev,
 * today, next), which is what a test drives too.
 *
 * @param {Element} root
 * @param {SitePayload} payload
 * @param {Date} now
 */
export const mountCalendar = (root, payload, now) => {
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
  /** @type {{ view: View, anchor: number, filter: Filter }} */
  const state = { view: "month", anchor: todayIndex, filter: "all" };

  /** @param {string} tag @param {string} [className] @param {string} [text] */
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /**
   * Page by the current view's unit: Week moves the anchor a whole week, every
   * other view a whole month (keeping the day-of-month where the target month is
   * long enough). @param {number} delta
   */
  const step = (delta) => {
    if (state.view === "week") {
      state.anchor += delta * 7;
    } else {
      const { year, month, day } = civilOf(state.anchor);
      const zeroBased = month - 1 + delta;
      const nextYear = year + Math.floor(zeroBased / 12);
      const nextMonth = ((zeroBased % 12) + 12) % 12 + 1;
      const lastDay = monthLength(nextYear, nextMonth);
      state.anchor = dayIndexOf(nextYear, nextMonth, Math.min(day, lastDay));
    }
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
   * The per-source freshness disclosure (#40) — always visible, in every view,
   * because it is the page's role as the only always-true proof the pipeline ran.
   * One line per source, its elapsed lag computed here from the baked instant and
   * the injected `now`; a source two days or more stale escalates to a prominent
   * warning. The unit is the source, never a record (ADR-0004).
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

  const render = () => {
    root.textContent = "";
    root.className = "calendar";

    // --- Controls: view switcher, type filter, navigation ----------------
    const controls = el("div", "calendar__controls");

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
    // stepped, so it lands home regardless of how far the reader wandered.
    nav.appendChild(navButton("today", "Today", () => {
      state.anchor = todayIndex;
      render();
    }));
    nav.appendChild(navButton("next", "Next ›", () => step(1)));
    nav.appendChild(title);

    controls.appendChild(views);
    controls.appendChild(filter);
    controls.appendChild(nav);
    root.appendChild(controls);

    // The freshness disclosure sits above every view's surface — it is not a
    // property of the month or the week, but of the data behind all of them.
    const fresh = renderFreshness();
    if (fresh) root.appendChild(fresh);

    // The one place the filter is applied — every view reads this same list (§4).
    const visible = filterEntries(entries, state.filter);
    const surface =
      state.view === "week" ? renderWeek(visible)
      : state.view === "agenda" ? renderAgenda(visible)
      : state.view === "spine" ? renderSpine(visible)
      : renderMonth(visible);
    root.appendChild(surface);
  };

  // --- Month: the navigator (unchanged from #38) -------------------------
  /** @param {DayEntry[]} visible @returns {HTMLElement} */
  const renderMonth = (visible) => {
    const { year, month } = civilOf(state.anchor);
    const cells = monthGridCells(year, month, todayKey);

    const grid = el("div", "calendar__grid");

    const head = el("div", "calendar__weekdays");
    for (const label of WEEKDAYS) head.appendChild(el("span", "calendar__weekday", label));
    grid.appendChild(head);

    const body = el("div", "calendar__weeks");
    for (const cell of cells) {
      const dayNode = el("div", "calendar__day");
      if (!cell.inMonth) dayNode.classList.add("calendar__day--outside");
      if (cell.isToday) dayNode.classList.add("calendar__day--today");
      dayNode.dataset["day"] = `${cell.year}-${pad2(cell.month)}-${pad2(cell.day)}`;

      dayNode.appendChild(el("span", "calendar__daynum", String(cell.day)));

      // Every entry on the day, in full. No overflow collapse: Month is the
      // navigator, and hiding entries behind a `+N more` count is the density
      // inversion #5 disqualified the grid for.
      for (const entry of entriesOnDay(visible, cell.key)) {
        dayNode.appendChild(renderEntry(entry));
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

    // Column headers: Mon–Sun with each day's date.
    const head = el("div", "week__head");
    head.appendChild(el("span", "week__corner"));
    days.forEach((d, i) => {
      const cell = el("div", "week__day");
      if (d.isToday) cell.classList.add("week__day--today");
      cell.dataset["day"] = `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
      cell.appendChild(el("span", "week__dayname", WEEKDAYS[i] ?? ""));
      cell.appendChild(el("span", "week__daynum", String(d.day)));
      head.appendChild(cell);
    });
    wrap.appendChild(head);

    // The all-day band: a multi-day entry has no single hour, so it rides a band
    // spanning the columns it covers (ADR-0009 §3), stacked into rows where two
    // bands overlap.
    const multiDay = visible.filter(
      (e) => e.startIndex !== e.endIndex && e.endIndex >= weekStart && e.startIndex <= weekEnd,
    );
    if (multiDay.length) {
      const band = el("div", "week__allday");
      band.appendChild(el("span", "week__corner", "All-day"));
      const grid = el("div", "week__band-grid");
      for (const { item, lane } of assignLanes(multiDay, (e) => e.startIndex, (e) => e.endIndex)) {
        const leftCol = Math.max(item.startIndex, weekStart) - weekStart;
        const rightCol = Math.min(item.endIndex, weekEnd) - weekStart;
        const node = renderEntry(item);
        node.classList.add("week__band");
        node.style.gridColumn = `${leftCol + 1} / ${rightCol + 2}`;
        node.style.gridRow = String(lane + 1);
        grid.appendChild(node);
      }
      band.appendChild(grid);
      wrap.appendChild(band);
    }

    // The hour grid: a gutter of hour marks, then one column per day with each
    // single-day entry positioned by its true published clock time. Overlapping
    // entries split the column into side-by-side lanes.
    const body = el("div", "week__grid");
    const gutter = el("div", "week__gutter");
    for (let hour = 0; hour < 24; hour += 3) {
      const mark = el("span", "week__hour", `${pad2(hour)}:00`);
      mark.style.top = `${(hour / 24) * 100}%`;
      gutter.appendChild(mark);
    }
    body.appendChild(gutter);

    for (const d of days) {
      const col = el("div", "week__col");
      if (d.isToday) col.classList.add("week__col--today");
      col.dataset["day"] = `${d.year}-${pad2(d.month)}-${pad2(d.day)}`;
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
    const daysInMonth = monthLength(year, month);
    const list = el("div", "agenda");
    let any = false;
    for (let day = 1; day <= daysInMonth; day += 1) {
      const onDay = entriesOnDay(visible, dayKey(year, month, day));
      if (!onDay.length) continue;
      any = true;
      const index = dayIndexOf(year, month, day);
      const dayNode = el("div", "agenda__day");
      dayNode.dataset["day"] = `${year}-${pad2(month)}-${pad2(day)}`;
      if (index === todayIndex) dayNode.classList.add("agenda__day--today");
      dayNode.appendChild(
        el("span", "agenda__date", `${weekdayLabel(index)} ${day} ${MONTHS_SHORT[month - 1]}`),
      );
      const items = el("div", "agenda__items");
      // `entriesOnDay` repeats a multi-day entry under each day it spans, so a
      // congress appears on each of its days here — as it should (§3).
      for (const entry of onDay) items.appendChild(renderEntry(entry, clockText(entry.start)));
      dayNode.appendChild(items);
      list.appendChild(dayNode);
    }
    if (!any) list.appendChild(el("p", "agenda__empty", "No entries this month."));
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

    const wrap = el("div", "spine");

    const axis = el("div", "spine__axis");
    for (let day = 1; day <= daysInMonth; day += 1) {
      const index = dayIndexOf(year, month, day);
      const row = el("div", "spine__date");
      row.dataset["day"] = `${year}-${pad2(month)}-${pad2(day)}`;
      if (index === todayIndex) row.classList.add("spine__date--today");
      row.appendChild(el("span", "spine__dayname", weekdayLabel(index)));
      row.appendChild(el("span", "spine__datenum", String(day)));
      axis.appendChild(row);
    }
    wrap.appendChild(axis);

    // Each entry is a vertical bar whose **height is its duration**, so a
    // multi-day congress physically dominates a three-hour fair. Span standing
    // in for magnitude is the whole point of this view (ADR-0009 §3/§5) — it is
    // still not a score: nothing is ranked, only measured against the clock.
    const track = el("div", "spine__track");
    const inMonth = visible.filter((e) => e.endValue > monthStart && e.startValue < monthEnd);
    for (const { item, lane, lanes } of assignLanes(inMonth, (e) => e.startValue, (e) => e.endValue)) {
      const start = Math.max(item.startValue, monthStart);
      const end = Math.min(item.endValue, monthEnd);
      const node = renderEntry(item, spanText(item.endValue - item.startValue));
      node.classList.add("spine__bar");
      node.style.top = `${((start - monthStart) / span) * 100}%`;
      node.style.height = `${Math.max(((end - start) / span) * 100, 0.8)}%`;
      node.style.left = `${(lane / lanes) * 100}%`;
      node.style.width = `${(1 / lanes) * 100}%`;
      track.appendChild(node);
    }
    wrap.appendChild(track);
    return wrap;
  };

  /**
   * One entry, rendered the same in every view: type, an optional time/duration
   * label, the name, where, and the source that produced it. `timeText` is the
   * one thing that differs — Month omits it, the reading surfaces supply it.
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

  render();
};
