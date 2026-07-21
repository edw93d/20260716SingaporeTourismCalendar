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
 * @typedef {{ uid: string, summary: string, start: string, end: string, location: string, source: string }} SiteEntry
 * @typedef {{ venueEvents: SiteEntry[], portCalls: SiteEntry[] }} SitePayload
 * @typedef {"VenueEvent" | "PortCall"} RecordType
 * @typedef {"all" | RecordType} Filter
 * @typedef {SiteEntry & { type: RecordType, startKey: number, endKey: number }} DayEntry
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

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Monday-first: business planning reads the working week as a unit. */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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

/** @param {string} value @returns {number} */
const keyOf = (value) => sgtDayKey(new Date(value));

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
  const tag = (entry, type) => ({
    ...entry,
    type,
    startKey: keyOf(entry.start),
    endKey: keyOf(entry.end),
  });
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

  /** @type {{ focus: { year: number, month: number }, filter: Filter }} */
  const state = { focus: sgtMonthOf(now), filter: "all" };

  /** @param {string} tag @param {string} [className] @param {string} [text] */
  const el = (tag, className, text) => {
    const node = doc.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  };

  /** Step the focus month by `delta`, wrapping the year. @param {number} delta */
  const step = (delta) => {
    const zeroBased = state.focus.month - 1 + delta;
    state.focus = {
      year: state.focus.year + Math.floor(zeroBased / 12),
      month: ((zeroBased % 12) + 12) % 12 + 1,
    };
    render();
  };

  const render = () => {
    root.textContent = "";
    root.className = "calendar";

    // --- Controls: the type filter and month navigation ------------------
    const controls = el("div", "calendar__controls");

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
    const title = el("span", "calendar__title", `${MONTHS[state.focus.month - 1]} ${state.focus.year}`);

    nav.appendChild(navButton("prev", "‹ Prev", () => step(-1)));
    // Today returns to the present from anywhere — and the focus is *reset*, not
    // stepped, so it lands home regardless of how far back the reader wandered.
    nav.appendChild(navButton("today", "Today", () => {
      state.focus = sgtMonthOf(now);
      render();
    }));
    nav.appendChild(navButton("next", "Next ›", () => step(1)));
    nav.appendChild(title);

    controls.appendChild(filter);
    controls.appendChild(nav);
    root.appendChild(controls);

    // --- The month grid --------------------------------------------------
    const visible = filterEntries(entries, state.filter);
    const cells = monthGridCells(state.focus.year, state.focus.month, todayKey);

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
    root.appendChild(grid);
  };

  /** @param {DayEntry} entry */
  const renderEntry = (entry) => {
    const node = el("div", "calendar__entry");
    node.dataset["type"] = entry.type;
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

  render();
};
