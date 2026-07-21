import { instant, type Instant } from "../domain/instant.js";
import type { PortCall, Scraped, SourceKey, Terminal } from "../domain/types.js";
import type { BrowserSession, FetchDeps, ParseFailure, ParseResult, Source } from "./types.js";

/**
 * Marina Bay Cruise Centre Singapore (MBCCS).
 *
 * The one source that needs a browser, the one with **no fallback** (#16 removed
 * the access request), and the costliest piece of v1. Everything specific to it
 * is here; the browser it drives is injected and owned by the core.
 *
 * **Why the browser, and why `Raw` is a harvested payload and not page bytes**
 * (ADR-0005 Amendment 2, ADR-0006 Amendment 1). The schedule at
 * `mbccs.com.sg/cruise-information` is a Next.js app whose grid is Tailwind
 * utility-class `<div>`s with **no id, no `data-*`, no stable class names**. The
 * stable UUID that keys each call lives only in the page's React state and the
 * API JSON that populated it — never in the rendered DOM. So there is nothing to
 * GET and nothing to read out of `content()`: `fetch` must operate the page and
 * harvest the state it already holds. The leaked Basic-auth credential in the JS
 * bundle is **never touched** (#37) — the page authenticates itself; we only read
 * what it has already loaded.
 *
 * The split ADR-0005 protects survives intact: `fetch` does all the driving and
 * returns the harvested records as opaque `Raw`; `parse` is pure over that JSON
 * and is fixture-tested with no browser and no network.
 *
 * Nothing beyond facts is read. `lastPort`/`nextPort` publish the previous and
 * next port and would make a tempting synthesised description; there is no field
 * on `PortCall` for one to land in, and there will not be (ADR-0002). `duration`
 * is derivable from the two datetimes and is not read either.
 */

const SCHEDULE_URL = "https://mbccs.com.sg/cruise-information?tab=cruise-schedule";

/**
 * The terminal is a **constant, not a scraped value** — one adapter means one
 * terminal, and `Terminal` is the closed union of the two MPA confirms exist.
 */
const TERMINAL: Terminal = "MBCCS";

// ---------------------------------------------------------------------------
// parse — pure, fixture-testable, no browser
// ---------------------------------------------------------------------------

/**
 * One harvested schedule record, exactly as the page's state holds it. Fields are
 * `unknown` because this is opaque source data validated on the way in — a record
 * that fails validation becomes a `ParseFailure`, never a guessed value.
 */
type MbccsRecord = {
  id?: unknown;
  vesselName?: unknown;
  berthingDateTime?: unknown;
  unberthingDateTime?: unknown;
  berthNo?: unknown;
  // duration / lastPort / nextPort are present in the payload and deliberately unread.
};

/**
 * What `fetch` hands `parse`.
 *
 * `schedule` is the harvested records, or **`null` when `fetch` could not locate
 * the schedule state at all** — the anchor (ADR-0006 Amendment 1). An **empty
 * array** is the genuine *"There are no scheduled cruises"* state; `null` means
 * the app did not hydrate, a redesign moved the state, or the page is not ours.
 * The contract is precise so `parse` can tell a quiet week from a broken read.
 */
export type MbccsRaw = {
  schedule: readonly MbccsRecord[] | null;
};

const asNonEmptyString = (value: unknown): string | null =>
  typeof value === "string" && value.trim() !== "" ? value : null;

/** `instant` throws on an unreadable time; a failed read is a `ParseFailure`, not a substitute. */
const tryInstant = (value: string): Instant | null => {
  try {
    return instant(value);
  } catch {
    return null;
  }
};

/**
 * The berth is the numeric `berthNo` the page renders as `Pier 1`. Stored in that
 * rendered form to match SCC's `Pier N` and the source's own label, then demoted
 * into the generated description (never the reader-facing location). Absent → null,
 * never a fabricated default.
 */
const berthFrom = (value: unknown): string | null => {
  if (typeof value === "number" && Number.isFinite(value)) return `Pier ${value}`;
  const text = asNonEmptyString(value);
  return text === null ? null : `Pier ${text}`;
};

/**
 * One harvested record → one PortCall, or one failure. Never neither, and never a
 * partial record with a guessed field (ADR-0006).
 */
const parseRecord = (
  record: MbccsRecord,
): { record: Scraped<PortCall> } | { failure: ParseFailure } => {
  const id = asNonEmptyString(record.id);
  const vessel = asNonEmptyString(record.vesselName);

  /** The whole record travels with the failure so it is debuggable without re-scraping. */
  const failed = (expected: string): { failure: ParseFailure } => ({
    failure: {
      // Keyed only where the id was read. `id` is the whole sourceKey, so either
      // the failure carries the real key or it carries none — never a half-made one.
      ...(id ? { sourceKey: id as SourceKey } : {}),
      fragment: JSON.stringify(record),
      expected,
    },
  });

  if (!id) {
    return failed(`a non-empty "id" — the source UUID this adapter uses as sourceKey`);
  }

  if (!vessel) {
    return failed(`a non-empty "vesselName", for the vessel as published`);
  }

  const berthing = asNonEmptyString(record.berthingDateTime);
  const arrival = berthing === null ? null : tryInstant(berthing);
  if (!arrival) {
    return failed(
      `a "berthingDateTime" as an absolute UTC instant like "2026-07-20T23:00:00Z", ` +
        `but got ${JSON.stringify(record.berthingDateTime)}`,
    );
  }

  const unberthing = asNonEmptyString(record.unberthingDateTime);
  const departure = unberthing === null ? null : tryInstant(unberthing);
  if (!departure) {
    return failed(
      `an "unberthingDateTime" as an absolute UTC instant like "2026-07-21T05:00:00Z", ` +
        `but got ${JSON.stringify(record.unberthingDateTime)}`,
    );
  }

  return {
    record: {
      source: mbccs.key,
      // `raw.id` is a real, stable source identifier (CONTEXT.md § sourceKey) — no
      // reschedule duplication and no same-day collision, unlike SCC's synthesised key.
      sourceKey: id as SourceKey,
      vessel,
      terminal: TERMINAL,
      berth: berthFrom(record.berthNo),
      // Already absolute UTC (`…Z`) in the payload — passed straight through, with
      // no +08:00 conversion. That is why `now` is unused: nothing here is relative.
      arrival,
      departure,
    },
  };
};

// ---------------------------------------------------------------------------
// fetch — drives the browser; the untested I/O seam (ADR-0005)
// ---------------------------------------------------------------------------

/**
 * How this page holds its state — **source knowledge, so it lives in the adapter**
 * (ADR-0005 Amendment 1), not in `html.ts`.
 *
 * The records array is not in the DOM, so it is read out of React by walking
 * fibers up from any element until a `memoizedProps` value is an array of objects
 * shaped like a schedule row. Returns that array (mapped down to the fields this
 * adapter reads), or `null` if no such array is mounted — which, combined with the
 * empty-state check below, is what lets `parse` separate a quiet week from a page
 * that never rendered the schedule.
 */
const HARVEST_RECORDS = `(() => {
  for (const el of document.querySelectorAll('*')) {
    const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
    if (!key) continue;
    for (let fiber = el[key], hops = 0; fiber && hops < 80; fiber = fiber.return, hops++) {
      const props = fiber.memoizedProps;
      if (!props || typeof props !== 'object') continue;
      for (const value of Object.values(props)) {
        if (
          Array.isArray(value) && value.length > 0 &&
          value.every((x) => x && typeof x === 'object' && 'vesselName' in x && 'berthingDateTime' in x)
        ) {
          return value.map((x) => ({
            id: x.id, vesselName: x.vesselName,
            berthingDateTime: x.berthingDateTime, unberthingDateTime: x.unberthingDateTime,
            berthNo: x.berthNo,
          }));
        }
      }
    }
  }
  return null;
})()`;

/**
 * The rendered empty state. MBCCS prints *"There are no scheduled cruises"* when a
 * window carries no calls, and that text **is** in the DOM even though the records
 * are not — so it is the reliable signal for the genuine empty case, which the
 * record-array walk above (matching only non-empty arrays) cannot see.
 */
const IS_EMPTY_STATE = `document.body.innerText.includes('no scheduled cruises')`;

/**
 * Hydration is done once the schedule has resolved to one state or the other:
 * either rows are mounted or the empty-state text is showing. Blocking on this
 * before harvesting is what keeps a mid-render snapshot out of the payload.
 */
const IS_SETTLED = `(${HARVEST_RECORDS} !== null) || (${IS_EMPTY_STATE})`;

/**
 * The pager — **all of this was verified live on 2026-07-21**, and three of the
 * assumptions carried in the original handoff were wrong.
 *
 * There is **no `totalPageCount` in the page's React state**: the app maps the API
 * envelope down to just the records array before storing it, so nothing in the
 * fiber tree carries a page count. The pager itself is the only source of truth,
 * and it is **bare `<div>`s** — no `<button>`, no `aria-label`, no `name` — a flex
 * row of numbered cells between a prev and a next chevron. The next chevron is the
 * row's last child; once there is no further page it carries `pointer-events-none`.
 *
 * So the walk is bounded not by a count but by that disabled state: harvest, and
 * while "next" is live, click it and block until the page actually swaps. `MAX_PAGES`
 * caps a pathological pager rather than spinning; the ~3-month window runs to a
 * handful of pages (≈20 calls each), so the cap is never reached in practice.
 */
const PAGER = `div.gap-4.mt-7.flex.justify-center`;
const NEXT_PAGE = `${PAGER} > div:last-child`;
const MAX_PAGES = 60;

const NEXT_PAGE_ENABLED = `(() => {
  const pager = document.querySelector('${PAGER}');
  if (!pager) return false;
  const next = pager.lastElementChild;
  return !!next && !next.className.includes('pointer-events-none');
})()`;

/**
 * The id of the first harvested record. A pager click fires an async refetch, and
 * `IS_SETTLED` is already true on the page being left, so it cannot detect the swap.
 * Blocking until this id changes is what proves the next page has actually arrived.
 */
const FIRST_RECORD_ID = `(() => {
  const records = ${HARVEST_RECORDS};
  return records && records[0] ? records[0].id : null;
})()`;

/**
 * The date filter is a react-day-picker range calendar with no Apply button: the
 * range applies on the second (end-date) click, which closes the picker and fires
 * the refetch. Widening to the ~3-month window every source publishes is therefore
 * open picker → click a start day → advance three months → click an end day.
 *
 * Verified live on 2026-07-21, correcting the handoff's selectors:
 *  - The filter trigger is a `<button>` with **no `aria-label`**; its only stable
 *    handle is the "(Today)" the default range prints, matched here by text.
 *  - Day buttons mark unselectable days with the `disabled` attribute (not a class),
 *    and the leading/trailing cells belonging to the adjacent month with `day-outside`.
 *    Excluding both leaves the in-month, selectable days.
 *  - Each day sits alone in its own `<td>`, so `:last-of-type` is **true of every
 *    day**, not just the last — the original end-date selector silently clicked the
 *    *first* day. Playwright's `>> nth=-1` addresses the genuine last in-month day.
 */
const FILTER_BUTTON = `button:has-text("(Today)")`;
const NEXT_MONTH = `button[name="next-month"]`;
const ENABLED_DAY = `button[name="day"]:not([disabled]):not(.day-outside)`;
const WINDOW_MONTHS = 3;

/**
 * The refetch fired by the end-date click has **no detectable start** — there is no
 * `isFetching` boolean in React state and no spinner/`aria-busy` in the DOM (verified
 * live 2026-07-21). And `IS_SETTLED` is already true on the *pre-widening* data, so
 * blocking on it after the click returns instantly on stale rows: the earlier code
 * harvested the `[Jul 1 → Jul 25]` result for a `[Jul 1 → Sep 30]` window.
 *
 * The honest settle without a loading signal is a **debounce over a signature**.
 * Extending the *end* of the range keeps the *first* record identical (the pager's
 * first-id trick is useless here), so the signature is `count | last berthingDateTime`
 * — the two things a widened window does move. `REFETCH_SETTLED` (below) is stateful
 * on `window` and is meant to be polled by `waitForFunction`.
 */
const HARVEST_SIGNATURE = `(() => {
  const records = ${HARVEST_RECORDS};
  if (records === null) return ${IS_EMPTY_STATE} ? 'empty' : 'none';
  const last = records[records.length - 1];
  return records.length + '|' + (last ? String(last.berthingDateTime) : '');
})()`;

/** Debounce once the harvest has swapped; grace period before accepting an unchanged window. */
const SETTLE_DEBOUNCE_MS = 400;
const SETTLE_NO_CHANGE_MS = 4000;

/**
 * Stash the pre-click signature and the click time on `window`, so `REFETCH_SETTLED`
 * can measure both "did the harvest change" and "how long since the click" without a
 * loading signal to hang on. Called immediately before the end-date click.
 */
const MARK_BEFORE_REFETCH = `(() => {
  window.__mbccsBefore = ${HARVEST_SIGNATURE};
  window.__mbccsClickAt = performance.now();
  window.__mbccsStableSig = null;
  window.__mbccsStableSince = 0;
  return true;
})()`;

/**
 * True once the widened window has settled. Two honest outcomes, no false positive on
 * stale data:
 *  - the signature **changed** from the pre-click value → wait until it holds steady for
 *    `SETTLE_DEBOUNCE_MS` (the refetch has landed and stopped moving), then settle;
 *  - the signature is **unchanged** → a genuinely small window (≤20 rows, extension adds
 *    nothing) legitimately looks identical, so settle only after `SETTLE_NO_CHANGE_MS`
 *    has passed since the click, giving the async refetch time to have fired first.
 * Polled by `waitForFunction`; each poll advances the in-page debounce state.
 */
const REFETCH_SETTLED = `(() => {
  const sig = ${HARVEST_SIGNATURE};
  const now = performance.now();
  if (sig !== window.__mbccsBefore) {
    if (window.__mbccsStableSig !== sig) {
      window.__mbccsStableSig = sig;
      window.__mbccsStableSince = now;
      return false;
    }
    return (now - window.__mbccsStableSince) >= ${SETTLE_DEBOUNCE_MS};
  }
  return (now - window.__mbccsClickAt) >= ${SETTLE_NO_CHANGE_MS};
})()`;

/**
 * Whether the picker can advance another month. The calendar caps forward
 * navigation at the far edge of MBCCS's published range — beyond it the
 * `next-month` button goes `disabled` **and `disabled:hidden`** (verified live
 * 2026-07-21), so clicking it blindly hangs on an invisible element. Gating on this
 * both avoids that hang and clamps the window to exactly what the source publishes.
 */
const NEXT_MONTH_ENABLED = `(() => {
  const button = document.querySelector('button[name="next-month"]');
  return !!button && !button.disabled;
})()`;

const widenToPublishingWindow = async (session: BrowserSession): Promise<void> => {
  await session.click(FILTER_BUTTON);
  // Start day: the first selectable day of the month the picker opens on. Past days
  // in the current month are selectable, so this can reach back to the 1st — a
  // harmless over-inclusion that still covers today forward across the window.
  await session.click(`${ENABLED_DAY} >> nth=0`);
  // Advance toward the window's far month, but stop early if the calendar caps out
  // first — the published range can be shorter than WINDOW_MONTHS.
  for (let month = 0; month < WINDOW_MONTHS; month++) {
    if (!(await session.evaluate<boolean>(NEXT_MONTH_ENABLED))) break;
    await session.click(NEXT_MONTH);
  }
  // End day: the last selectable day now shown. Selecting it applies the range and
  // fires the refetch. Mark the pre-click signature first, then block on the debounce
  // settle — not IS_SETTLED, which is already true on the pre-widening rows.
  await session.evaluate(MARK_BEFORE_REFETCH);
  await session.click(`${ENABLED_DAY} >> nth=-1`);
  await session.waitForFunction(REFETCH_SETTLED);
};

// ---------------------------------------------------------------------------

export const mbccs: Source<PortCall, MbccsRaw> = {
  key: "mbccs",

  /**
   * All the I/O. Loads the page, waits for hydration, widens the date filter to
   * the publishing window, walks pagination, and harvests the records the page
   * holds — returning them as opaque `Raw`. Constructs nothing: the browser is
   * injected, and `http` is not destructured because this source has no plain GET.
   *
   * **Navigation lives here; extraction stays pure in `parse`** (ADR-0005). The
   * pager walk is navigation ("is there a next page"), so it belongs to `fetch`.
   */
  fetch: async ({ browser }: FetchDeps): Promise<MbccsRaw> => {
    if (!browser) {
      // The adapter cannot construct one, by design (headless is scoped to this
      // source). A run that reaches here without a browser is a wiring error, and
      // it should say so loudly rather than return an empty schedule that would
      // read as a quiet week.
      throw new Error("mbccs requires an injected browser session, but none was provided");
    }

    await browser.goto(SCHEDULE_URL);
    await browser.waitForFunction(IS_SETTLED);
    await widenToPublishingWindow(browser);

    // Walk the pager a page at a time until its "next" chevron goes disabled. The
    // page exposes no total, so that disabled state is the honest terminator; the
    // bounded loop caps a pathological pager rather than spinning forever.
    const harvested: MbccsRecord[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const pageRecords = await browser.evaluate<MbccsRecord[] | null>(HARVEST_RECORDS);
      if (pageRecords) harvested.push(...pageRecords);

      const hasNext = await browser.evaluate<boolean>(NEXT_PAGE_ENABLED);
      if (!hasNext) break;

      // Capture the leaving page's first id, click next, then block until the async
      // refetch has actually swapped it in (IS_SETTLED is true on both pages).
      const leaving = await browser.evaluate<unknown>(FIRST_RECORD_ID);
      await browser.click(NEXT_PAGE);
      await browser.waitForFunction(`(${FIRST_RECORD_ID}) !== ${JSON.stringify(leaving)}`);
    }

    if (harvested.length > 0) return { schedule: harvested };

    // No records mounted. Distinguish a genuine empty window from a page that
    // never rendered the schedule — the anchor distinction (ADR-0006 Amendment 1).
    const empty = await browser.evaluate<boolean>(IS_EMPTY_STATE);
    return { schedule: empty ? [] : null };
  },

  /**
   * Pure. `now` is **declared and deliberately unused**: every datetime in the
   * payload is an absolute UTC instant, so nothing is relative to the moment of
   * reading and the fixtures cannot drift as they age. Written out rather than
   * omitted so the purity test — two very different clocks, equal output — is
   * actually exercising the parameter (see scc.ts for the arity-widening trap).
   */
  parse: (raw: MbccsRaw, now: Date): ParseResult<Scraped<PortCall>> => {
    void now;

    // The anchor (ADR-0006 Amendment 1), checked before any record is examined.
    // `null` means fetch never located the schedule state — not our document, a
    // redesign, or a failed hydration. An empty array is a genuine quiet window.
    if (!Array.isArray(raw.schedule)) {
      return {
        ok: false,
        reason:
          "the schedule payload is absent — fetch could not locate MBCCS's schedule " +
          "state (the app did not hydrate, a redesign moved it, or the page is not " +
          "the MBCCS cruise schedule)",
      };
    }

    const records: Scraped<PortCall>[] = [];
    const failures: ParseFailure[] = [];
    for (const record of raw.schedule) {
      const outcome = parseRecord(record);
      if ("record" in outcome) records.push(outcome.record);
      else failures.push(outcome.failure);
    }

    // Anchor present with zero records lands here as `records: []` — a genuinely
    // quiet window is a fact about the source, not a failure to read it.
    return { ok: true, records, failures };
  },
};
