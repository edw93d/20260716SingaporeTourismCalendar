// @ts-check

/**
 * The moderator spreadsheet's client layer — the write half of the admin page,
 * the counterpart to `site/calendar.js`'s read half. The page arrives
 * server-rendered (`src/server/admin.ts`): a table of records whose Review-state
 * and Shown cells are `.pill` buttons, whose headers carry `data-key`/`data-funnel`
 * and whose date cells carry `data-facet`/`data-sort`. This module attaches every
 * interaction the moderator needs to work the ~670-row day-one backfill:
 *
 * - **Toggle** (#156): a click on a state pill flips one flag under the admin auth
 *   boundary and raises an **Undo** toast (ADR-0024 §7 — hiding is genuinely
 *   reversible; nothing here retires a uid).
 * - **Sort** (#157): a click on a column label sorts the rows by that column,
 *   ascending then descending, chronologically for the date columns (they carry a
 *   numeric `data-sort`) and by text for the rest.
 * - **Funnel filters** (#157): each funnel-able header opens an Excel-style menu of
 *   its distinct values; the filters **compose** across columns (AND), so "one
 *   venue in one month across all sources" is one venue box and one month box.
 * - **Bulk bar** (#157): a fixed bar that hides or marks *the whole filtered
 *   selection* in one action — filter-then-bulk — each raising one Undo toast that
 *   reverts the exact set it changed.
 *
 * Same seam discipline as the calendar client (#38): the one thing it cannot be
 * allowed to reach for itself — the network — is **injected** as `fetch`, and the
 * document is read from the mount root's owner, never a global. That injection is
 * what lets `tests/admin-client.test.ts` drive filter, sort and the bulk loop
 * against jsdom with a fake `fetch`. The page's bootstrap supplies `window.fetch`.
 *
 * Free software under AGPLv3 with the rest of the repository.
 *
 * @typedef {"hidden" | "reviewed"} ModerationFlag
 * @typedef {(input: string, init?: RequestInit) => Promise<Response>} FetchLike
 * @typedef {{ fetch: FetchLike }} MountOptions
 */

/** The single-record write route (#156) and the whole-selection one (#157). */
const FLAG_ROUTE = "/admin/flag";
const BULK_ROUTE = "/admin/flag/bulk";

/**
 * The label a pill shows for a flag at a value. `reviewed` reads as itself;
 * `hidden` reads through the Shown column, so a hidden record's pill says
 * "Hidden" and a shown one says "Shown" — the same words the server renders, kept
 * here so a click can relabel without a reload.
 * @param {ModerationFlag} flag
 * @param {boolean} value
 * @returns {string}
 */
const labelFor = (flag, value) =>
  flag === "reviewed" ? (value ? "Reviewed" : "Unreviewed") : value ? "Hidden" : "Shown";

/**
 * The short human name of a flag at a value, for the toast sentence — "Hidden",
 * "Shown", "Marked reviewed", "Marked unreviewed". Shared by the single toggle
 * (#156) and the bulk action (#157), so "Hidden “BNI Vision”." and "Hidden 12
 * records." read from the same words.
 * @param {ModerationFlag} flag
 * @param {boolean} value
 * @returns {string}
 */
const actionFor = (flag, value) =>
  flag === "reviewed" ? (value ? "Marked reviewed" : "Marked unreviewed") : value ? "Hidden" : "Shown";

/**
 * The imperative of an action, for the "nothing to change" message — "hide",
 * "show", "mark reviewed", "mark unreviewed" — so "No records to hide." reads as
 * an instruction rather than as the past-tense the toast uses when a write lands.
 * @param {ModerationFlag} flag
 * @param {boolean} value
 * @returns {string}
 */
const verbFor = (flag, value) =>
  flag === "reviewed" ? (value ? "mark reviewed" : "mark unreviewed") : value ? "hide" : "show";

/**
 * Writes a flag's value back onto its pill: the label, the `data-value` a later
 * click reads, and `aria-pressed` for both styling and assistive tech. One place,
 * so a click, an Undo and a bulk action relabel identically.
 * @param {HTMLButtonElement} pill
 * @param {ModerationFlag} flag
 * @param {boolean} value
 */
const applyState = (pill, flag, value) => {
  pill.dataset["value"] = String(value);
  pill.setAttribute("aria-pressed", String(value));
  pill.textContent = labelFor(flag, value);
};

/**
 * Reads the flag a pill toggles off its `data-flag`, validated against the closed
 * set — a pill the server did not render (or one mangled) is ignored rather than
 * posting an unknown column.
 * @param {Element} pill
 * @returns {ModerationFlag | null}
 */
const flagOf = (pill) => {
  const flag = /** @type {HTMLElement} */ (pill).dataset["flag"];
  return flag === "hidden" || flag === "reviewed" ? flag : null;
};

/**
 * The value the funnel filter groups a cell by — its `data-facet` if the server
 * supplied one (the month, for a date cell), else the cell's visible text (a
 * venue, a source key, a live pill label). Reading the pill label live is what
 * keeps a state funnel honest after a toggle relabels the pill.
 * @param {Element} cell
 * @returns {string}
 */
const facetOf = (cell) =>
  /** @type {HTMLElement} */ (cell).dataset["facet"] ?? (cell.textContent ?? "").trim();

/**
 * The key a click-label sort orders a cell by — its `data-sort` if present (epoch
 * milliseconds, for a date cell) else its visible text.
 * @param {Element} cell
 * @returns {string}
 */
const sortKeyOf = (cell) =>
  /** @type {HTMLElement} */ (cell).dataset["sort"] ?? (cell.textContent ?? "").trim();

/**
 * Orders two sort keys. Numeric when both are numbers (the date columns' epoch-ms
 * keys, so July sorts before August rather than alphabetically), and by locale
 * text otherwise (names, venues, source keys, state words).
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
const compareKeys = (a, b) => {
  const na = Number(a);
  const nb = Number(b);
  if (a !== "" && b !== "" && !Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
  return a.localeCompare(b);
};

/**
 * Mounts every admin interaction into `root` (the admin page's `<body>`). Returns
 * nothing; the wiring lives on `root` for its lifetime, which is the page's.
 * @param {HTMLElement} root
 * @param {MountOptions} options
 */
export const mountAdmin = (root, options) => {
  const doc = root.ownerDocument;
  if (!doc) throw new Error("mountAdmin needs a root attached to a document.");
  const { fetch } = options;

  // -------------------------------------------------------------------------
  // Toast — one live message, replaced (never stacked) by each new action.
  // -------------------------------------------------------------------------

  /** @type {HTMLElement | null} */
  let toast = null;

  const clearToast = () => {
    if (toast) {
      toast.remove();
      toast = null;
    }
  };

  /**
   * Raises a toast, replacing any live one. With an `undo` it carries an **Undo**
   * button whose click reverts the exact write and clears the toast; without one
   * it is a plain message — the error path, which must not offer an Undo for a
   * write that never landed.
   * @param {string} message
   * @param {(() => Promise<void>) | undefined} [undo]
   */
  const showToast = (message, undo) => {
    clearToast();
    const el = doc.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    const text = doc.createElement("span");
    text.textContent = message;
    el.append(text);
    if (undo) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "undo";
      button.textContent = "Undo";
      button.addEventListener("click", () => void undo());
      el.append(button);
    }
    root.append(el);
    toast = el;
  };

  // -------------------------------------------------------------------------
  // Single-pill write (#156). The pill is disabled in flight so a double-click
  // cannot race two writes; a non-2xx or a thrown fetch leaves the pill exactly
  // as it was and surfaces a plain error, so the page never shows a state the
  // store did not accept.
  // -------------------------------------------------------------------------

  /**
   * @param {HTMLButtonElement} pill
   * @param {string} uid
   * @param {ModerationFlag} flag
   * @param {boolean} value
   * @returns {Promise<boolean>}
   */
  const write = async (pill, uid, flag, value) => {
    pill.disabled = true;
    try {
      const response = await fetch(FLAG_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uid, flag, value }),
      });
      if (!response.ok) {
        showToast("Could not save that change.");
        return false;
      }
      applyState(pill, flag, value);
      return true;
    } catch {
      showToast("Could not save that change.");
      return false;
    } finally {
      pill.disabled = false;
    }
  };

  // -------------------------------------------------------------------------
  // The grid — sort, funnel filters and the bulk bar. All of it reads the table
  // the server rendered; if there is none (a defensive branch — the page always
  // has one), the pill toggle above still works and the rest simply does nothing.
  // -------------------------------------------------------------------------

  const table = root.querySelector("table");
  const thead = table?.querySelector("thead");
  const tbody = table?.querySelector("tbody");

  if (table && thead && tbody) {
    const gridBody = tbody;
    const headers = /** @type {HTMLTableCellElement[]} */ (
      Array.from(thead.querySelectorAll("th[data-key]"))
    );

    /** Every data row, live off the DOM (order changes as sort reorders them). */
    const rows = () =>
      /** @type {HTMLTableRowElement[]} */ (Array.from(gridBody.querySelectorAll("tr[data-uid]")));

    /**
     * The cell in `row` under column `index`, or null if the row is short —
     * `cells[index]` can be undefined under `noUncheckedIndexedAccess`.
     * @param {HTMLTableRowElement} row
     * @param {number} index
     * @returns {HTMLTableCellElement | null}
     */
    const cellAt = (row, index) => row.cells[index] ?? null;

    // --- Filters: colIndex -> the set of *kept* facet values. A column with no
    // entry is unfiltered; the sets compose as an AND across columns. ----------

    /** @type {Map<number, Set<string>>} */
    const filters = new Map();

    /** A row shows only if every active filter keeps its cell's facet. */
    const rowMatches = (/** @type {HTMLTableRowElement} */ row) => {
      for (const [index, kept] of filters) {
        const cell = cellAt(row, index);
        if (cell === null || !kept.has(facetOf(cell))) return false;
      }
      return true;
    };

    /** The rows the filters currently leave showing — the bulk bar's target. */
    const visibleRows = () => rows().filter((row) => rowMatches(row));

    /**
     * Applies the current filters to the DOM: each row hidden or shown, each
     * header flagged as filtered, and the bulk count refreshed. Called after any
     * change that can move a row in or out of the selection — a filter edit or a
     * bulk action that relabels a state cell. A sort only reorders rows, so it does
     * not call this.
     */
    const applyFilters = () => {
      for (const row of rows()) row.hidden = !rowMatches(row);
      for (const th of headers) th.classList.toggle("filtered", filters.has(th.cellIndex));
      refreshBulkCount();
    };

    // --- Sort: click a header to sort by its column, toggling direction. -------

    /** @type {{ index: number; dir: 1 | -1 } | null} */
    let sort = null;

    const sortBy = (/** @type {number} */ index) => {
      const dir = sort && sort.index === index ? /** @type {1 | -1} */ (-sort.dir) : 1;
      sort = { index, dir };

      const ordered = rows().sort((a, b) => {
        const ca = cellAt(a, index);
        const cb = cellAt(b, index);
        return dir * compareKeys(ca ? sortKeyOf(ca) : "", cb ? sortKeyOf(cb) : "");
      });
      // Re-appending a live node moves it, so the tbody ends in sorted order.
      for (const row of ordered) gridBody.append(row);

      for (const th of headers) {
        if (th.cellIndex === index) th.setAttribute("aria-sort", dir === 1 ? "ascending" : "descending");
        else th.removeAttribute("aria-sort");
      }
    };

    // --- Funnel menu: the distinct values of one column, as checkboxes. --------

    /** @type {HTMLElement | null} */
    let menu = null;

    const closeMenu = () => {
      if (menu) {
        menu.remove();
        menu = null;
      }
      for (const th of headers) th.querySelector(".funnel")?.setAttribute("aria-expanded", "false");
    };

    /**
     * The distinct facet values in a column, ordered the way the column sorts —
     * so a month funnel lists July before August, not alphabetically. Each value
     * is ordered by the smallest sort key seen for it.
     * @param {number} index
     * @returns {string[]}
     */
    const distinctFacets = (index) => {
      /** @type {Map<string, string>} */
      const repKey = new Map();
      for (const row of rows()) {
        const cell = cellAt(row, index);
        if (cell === null) continue;
        const facet = facetOf(cell);
        const key = sortKeyOf(cell);
        const seen = repKey.get(facet);
        if (seen === undefined || compareKeys(key, seen) < 0) repKey.set(facet, key);
      }
      return Array.from(repKey.keys()).sort((a, b) =>
        compareKeys(repKey.get(a) ?? a, repKey.get(b) ?? b),
      );
    };

    /**
     * Opens the funnel menu for a column under its header. The checkboxes start
     * from the current filter (all checked when the column is unfiltered), and any
     * change re-derives the filter from what is checked: all checked → the column
     * is unfiltered; otherwise the kept set is exactly the checked values.
     * @param {HTMLTableCellElement} th
     */
    const openMenu = (th) => {
      closeMenu();
      const index = th.cellIndex;
      const values = distinctFacets(index);
      const kept = filters.get(index);

      const el = doc.createElement("div");
      el.className = "menu";

      /** @type {HTMLInputElement[]} */
      const boxes = [];

      const onChange = () => {
        const checked = boxes.filter((b) => b.checked).map((b) => b.value);
        if (checked.length === values.length) filters.delete(index);
        else filters.set(index, new Set(checked));
        applyFilters();
      };

      const actions = doc.createElement("div");
      actions.className = "menu-actions";
      const all = doc.createElement("button");
      all.type = "button";
      all.textContent = "All";
      all.addEventListener("click", () => {
        for (const b of boxes) b.checked = true;
        onChange();
      });
      const none = doc.createElement("button");
      none.type = "button";
      none.textContent = "None";
      none.addEventListener("click", () => {
        for (const b of boxes) b.checked = false;
        onChange();
      });
      actions.append(all, none);
      el.append(actions);

      for (const value of values) {
        const label = doc.createElement("label");
        const box = doc.createElement("input");
        box.type = "checkbox";
        box.value = value;
        box.checked = kept === undefined || kept.has(value);
        box.addEventListener("change", onChange);
        boxes.push(box);
        const span = doc.createElement("span");
        span.textContent = value;
        label.append(box, span);
        el.append(label);
      }

      th.append(el);
      menu = el;
      th.querySelector(".funnel")?.setAttribute("aria-expanded", "true");
    };

    // Inject a funnel button into every funnel-able header. Injected here rather
    // than server-rendered so a no-JS page shows plain, legible headers instead of
    // dead controls.
    for (const th of headers) {
      if (!("funnel" in th.dataset)) continue;
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "funnel";
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-label", `Filter by ${(th.textContent ?? "").trim()}`);
      button.textContent = "▾";
      th.append(button);
    }

    // One listener on the header row. A click on a funnel toggles its menu; a
    // click inside an open menu is left to the checkboxes; anything else on a
    // header sorts by that column.
    thead.addEventListener("click", (event) => {
      const target = /** @type {Element | null} */ (event.target);
      if (!target) return;
      const funnel = target.closest(".funnel");
      if (funnel) {
        const th = /** @type {HTMLTableCellElement | null} */ (funnel.closest("th[data-key]"));
        const isOpen = funnel.getAttribute("aria-expanded") === "true";
        if (isOpen || th === null) closeMenu();
        else openMenu(th);
        return;
      }
      if (target.closest(".menu")) return;
      const th = /** @type {HTMLTableCellElement | null} */ (target.closest("th[data-key]"));
      if (th) sortBy(th.cellIndex);
    });

    // Close an open menu on any click outside it and its funnel.
    doc.addEventListener("click", (event) => {
      if (!menu) return;
      const target = /** @type {Element | null} */ (event.target);
      if (target && (target.closest(".menu") || target.closest(".funnel"))) return;
      closeMenu();
    });

    // --- The bulk bar: hide/show/mark the whole filtered selection. ------------

    /** The pill in `row` for `flag`, or null. */
    const pillFor = (/** @type {HTMLTableRowElement} */ row, /** @type {ModerationFlag} */ flag) =>
      /** @type {HTMLButtonElement | null} */ (row.querySelector(`.pill[data-flag="${flag}"]`));

    /**
     * Sends one bulk write and reports whether it landed. Errors leave every pill
     * exactly as it was and surface a plain error, mirroring the single write.
     * @param {string[]} uids
     * @param {ModerationFlag} flag
     * @param {boolean} value
     * @returns {Promise<boolean>}
     */
    const bulkWrite = async (uids, flag, value) => {
      try {
        const response = await fetch(BULK_ROUTE, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ uids, flag, value }),
        });
        if (!response.ok) {
          showToast("Could not save those changes.");
          return false;
        }
        return true;
      } catch {
        showToast("Could not save those changes.");
        return false;
      }
    };

    /**
     * Flips one flag to `value` across the filtered selection — but only the rows
     * where that is a *change*, so the affected set is homogeneous and its Undo
     * (the opposite value over the same uids) restores exactly what changed and
     * nothing that was already in that state.
     * @param {ModerationFlag} flag
     * @param {boolean} value
     */
    const bulkApply = async (flag, value) => {
      const targets = visibleRows().filter((row) => {
        const pill = pillFor(row, flag);
        return pill !== null && (pill.dataset["value"] === "true") !== value;
      });
      if (targets.length === 0) {
        showToast(`No records to ${verbFor(flag, value)}.`);
        return;
      }
      const uids = targets.map((row) => row.dataset["uid"] ?? "");

      const relabel = (/** @type {boolean} */ to) => {
        for (const row of targets) {
          const pill = pillFor(row, flag);
          if (pill) applyState(pill, flag, to);
        }
        applyFilters();
      };

      if (!(await bulkWrite(uids, flag, value))) return;
      relabel(value);
      const verb = actionFor(flag, value);
      showToast(`${verb} ${targets.length} record${targets.length === 1 ? "" : "s"}.`, async () => {
        if (!(await bulkWrite(uids, flag, !value))) return;
        relabel(!value);
        clearToast();
      });
    };

    const bar = doc.createElement("div");
    bar.className = "bulkbar";
    const count = doc.createElement("span");
    count.className = "count";
    bar.append(count);

    /** @type {Array<[string, ModerationFlag, boolean]>} */
    const bulkButtons = [
      ["Hide", "hidden", true],
      ["Show", "hidden", false],
      ["Mark reviewed", "reviewed", true],
      ["Mark unreviewed", "reviewed", false],
    ];
    for (const [text, flag, value] of bulkButtons) {
      const button = doc.createElement("button");
      button.type = "button";
      button.textContent = text;
      button.addEventListener("click", () => void bulkApply(flag, value));
      bar.append(button);
    }
    root.append(bar);

    /** Refreshes the bulk bar's count of the rows in the current selection. */
    function refreshBulkCount() {
      const n = visibleRows().length;
      count.textContent = `${n} record${n === 1 ? "" : "s"} shown`;
    }

    refreshBulkCount();
  }

  // -------------------------------------------------------------------------
  // Pill toggle — attached to `root` so it survives sorts (which move the rows).
  // -------------------------------------------------------------------------

  root.addEventListener("click", (rawEvent) => {
    const target = /** @type {Element | null} */ (rawEvent.target);
    const pill = target?.closest(".pill");
    if (!(pill instanceof HTMLButtonElement)) return;

    const flag = flagOf(pill);
    const row = pill.closest("tr[data-uid]");
    if (flag === null || !(row instanceof HTMLElement)) return;
    const uid = row.dataset["uid"];
    if (uid === undefined || uid === "") return;

    const current = pill.dataset["value"] === "true";
    const next = !current;
    const name = row.querySelector(".name")?.textContent ?? "this listing";

    void write(pill, uid, flag, next).then((ok) => {
      if (!ok) return;
      showToast(`${actionFor(flag, next)} “${name}”.`, async () => {
        const reverted = await write(pill, uid, flag, current);
        if (reverted) clearToast();
      });
    });
  });
};
