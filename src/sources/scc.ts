import { instant } from "../domain/instant.js";
import type { PortCall, Scraped, SourceKey, Terminal } from "../domain/types.js";
import { textOf } from "./html.js";
import type { FetchDeps, ParseFailure, ParseResult, Source } from "./types.js";

/**
 * Singapore Cruise Centre.
 *
 * One server-rendered GET returns the whole ~3-month publishing window — 17
 * sailings on 2026-07-20, one `<table>`, no pagination and no JS. Nothing here
 * needs a browser, and this adapter is not offered one.
 *
 * **The anchor is the load-bearing part of this module.** SCC sits behind
 * Imperva, which is passive today and returned HTTP 200 with full content on
 * every request we have made — but it is a switch the operator can flip, and it
 * is the likeliest of the three sources to start defending. Its challenge page
 * is also served with **HTTP 200** and carries no rows, so it is byte-plausible
 * as a quiet week: a parser that counts rows reports `records: []` and thereby
 * asserts that no ship calls at Singapore for three months, having never seen
 * the schedule. Checking the table before any row is what separates the two.
 *
 * Nothing beyond facts is read. The `FROM` and `NEXT` columns publish the
 * previous and next port and would make a tempting synthesised description;
 * there is no field on `PortCall` for one to land in, and there will not be
 * (ADR-0002).
 */

const SCHEDULE_URL = "https://singaporecruise.com.sg/schedule/cruise/";

/**
 * The terminal is a **constant, not a scraped value** — one adapter means one
 * terminal by construction, and `Terminal` is a closed union of the two MPA
 * confirms exist. The page names the building in prose that a copy edit could
 * rename mid-history.
 */
const TERMINAL: Terminal = "Singapore Cruise Centre";

/**
 * The structural anchor (ADR-0006), checked before any row is examined.
 *
 * It is the schedule **table**, not a row — deliberately, because the two states
 * this has to separate are *quiet week* and *not our document*, and a row
 * selector cannot tell them apart: both yield zero rows. WordPress renders the
 * table with its header whether or not any sailing is listed, so its presence is
 * exactly the claim "we are looking at SCC's cruise schedule."
 *
 * `schedule-table` is matched as a **whole class token**, bounded by whitespace
 * or the closing quote. A prefix match would also be satisfied by
 * `schedule-table_cruise` alone, and a `\b` boundary by anything hyphenated off
 * it — an anchor a redesign could keep by accident is no anchor at all.
 */
const ANCHOR = /<table[^>]*\bclass="(?:[^"]*\s)?schedule-table(?:\s[^"]*)?"/;

/** The anchor's table, so no other table on the page can contribute a row. */
const TABLE_END = "</table>";

const ROW = /<tr[^>]*>([\s\S]*?)<\/tr>/g;

/**
 * Cells are read by their `data-label`, not by column position.
 *
 * Position is the obvious parse and the silent one: swap the first two columns
 * in a redesign and every record arrives with arrival and departure exchanged,
 * parsing cleanly and reporting nothing. The labels name what they carry, so a
 * source that stops publishing them produces failures — which is the honest
 * outcome, and one the operator hears about.
 *
 * The header row carries `<th>` and no `<td>`, so it yields no cells and is
 * skipped without needing to be recognised.
 *
 * `textOf` strips tags rather than reading text nodes, and that is what keeps the
 * cruise line's logo out of the vessel: several rows lead with an
 * `<img src="…wp-content…">`, and a naive read welds that URL to the front of the
 * vessel string — and from there into `sourceKey`, permanently.
 */
const cell = (row: string, label: string): string | null => {
  const match = new RegExp(`<td[^>]*\\bdata-label="${label}"[^>]*>([\\s\\S]*?)</td>`).exec(row);
  return match ? textOf(match[1]!) : null;
};

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/**
 * `Thu, 30 Jul 2026 0800` — the weekday is decorative, the clock is four digits
 * in its own `<span>`, and **no timezone marker is published anywhere on the
 * page**. Asia/Singapore is a fixed +08:00 with no DST since 1982, so the offset
 * is written out here as a literal and the conversion to UTC is lossless.
 *
 * Returned as the published local date alongside the instant, because the
 * `sourceKey` is dated by the day the source printed rather than by the UTC
 * instant. A 0700 SGT call is 23:00Z the day before; keying off that would give
 * the record a key disagreeing with the page it was read from.
 */
const CALL_TIME = /^(?:[A-Za-z]{3},\s*)?(\d{1,2})\s+([A-Za-z]{3,})\s+(\d{4})\s+(\d{2})(\d{2})$/;

const callTime = (value: string): { at: ReturnType<typeof instant>; date: string } | null => {
  const match = CALL_TIME.exec(value);
  if (!match) return null;

  const [, day, month, year, hour, minute] = match;
  const numeral = MONTHS[month!.slice(0, 3).toLowerCase()];
  if (!numeral) return null;

  const date = `${year}-${numeral}-${day!.padStart(2, "0")}`;
  try {
    // `instant` refuses an impossible date rather than rolling it over into a
    // plausible one, so a published `31 Sep` fails here instead of becoming 1 Oct.
    return { at: instant(`${date}T${hour}:${minute}:00+08:00`), date };
  } catch {
    return null;
  }
};

/**
 * The `sourceKey`: `{vessel}|{arrivalDate}`.
 *
 * **This duplicates on reschedule, and that is accepted for v1** (`CONTEXT.md`
 * § sourceKey). The table exposes no identifier of any kind — no row id, no
 * booking reference, no detail link — so a call shifted by a day is a
 * delete-plus-create rather than a move: a new `uid`, a duplicate beside a stale
 * entry, and the update a subscriber most needs delivered as the one thing it is
 * not. Nothing weaker is available; keying on the vessel alone would merge a
 * ship's nine separate calls into one.
 *
 * Two consequences worth stating rather than discovering:
 *
 * - A vessel calling **twice on one local date** collapses to one key, and the
 *   later row overwrites the earlier. Not observed in the published window
 *   (17 sailings, 17 distinct keys), and the same missing identifier that causes
 *   the reschedule flaw is what leaves no honest alternative.
 * - ADR-0007's breakage detection absorbs the reschedule case by construction:
 *   one out and one in is net zero, while a dead selector takes rows away and
 *   puts nothing back.
 *
 * It is contained here on purpose. `sourceKey` is opaque to the core (ADR-0004),
 * so the blast radius is this function — nothing downstream inspects the key.
 */
const keyFor = (vessel: string, arrivalDate: string): SourceKey => `${vessel}|${arrivalDate}`;

/**
 * One row → one record, or one failure. Never neither, and never a partial
 * record with a guessed field.
 */
const parseRow = (row: string): { record: Scraped<PortCall> } | { failure: ParseFailure } => {
  const vessel = cell(row, "CRUISE SHIP");
  const arrival = cell(row, "ARRIVAL");
  const arrivalAt = arrival === null ? null : callTime(arrival);

  /** The fragment travels with the failure so it is debuggable without re-scraping. */
  const failed = (expected: string) => ({
    failure: {
      // Keyed only where the row got far enough to be keyed. A half-made key
      // would be a worse identifier than none: it would collide with a real one.
      ...(vessel && arrivalAt ? { sourceKey: keyFor(vessel, arrivalAt.date) } : {}),
      fragment: row.trim(),
      expected,
    },
  });

  if (!vessel) {
    return failed("a non-empty CRUISE SHIP cell, for the vessel as published");
  }

  if (!arrivalAt) {
    return failed(
      `an ARRIVAL cell reading like "Thu, 30 Jul 2026 0800" in local +08:00, ` +
        `but got ${JSON.stringify(arrival)}`,
    );
  }

  const departure = cell(row, "DEPARTURE");
  const departureAt = departure === null ? null : callTime(departure);
  if (!departureAt) {
    return failed(
      `a DEPARTURE cell reading like "Sat, 1 Aug 2026 1900" in local +08:00, ` +
        `but got ${JSON.stringify(departure)}`,
    );
  }

  return {
    record: {
      source: scc.key,
      sourceKey: keyFor(vessel, arrivalAt.date),
      vessel,
      terminal: TERMINAL,
      // Nullable, never a fabricated default: this table has five columns and a
      // berth is not among them. MBCCS publishes `berthNo`; SCC publishes none.
      berth: null,
      arrival: arrivalAt.at,
      departure: departureAt.at,
    },
  };
};

export const scc: Source<PortCall, string> = {
  key: "scc",

  /**
   * One GET, through the injected client. The core owns user agent, rate limit,
   * timeout and retry, so politeness here is structural: this adapter has no
   * other route to the network, and `deps.browser` is not destructured because a
   * server-rendered page has no use for one.
   *
   * The unfiltered default view is what is read. A `?date=` range filter exists
   * on the page; its parameter format was never established, and the default
   * already spans the whole ~3-month window the source publishes.
   */
  fetch: async ({ http }: FetchDeps) => http.get(SCHEDULE_URL),

  /**
   * Pure. `now` is **declared and deliberately unused**: every field below comes
   * from an absolute published date in a zone with no DST, so nothing is relative
   * to the moment of reading and the fixtures cannot drift as they age past the
   * publishing window.
   *
   * It is written out rather than omitted so the purity test — which calls this
   * with two very different clocks and asserts equal output — is actually
   * exercising the parameter. Omitted, the signature still satisfies
   * `Source<T, Raw>` by arity-widening, and that test can never fail.
   */
  parse: (raw: string, now: Date): ParseResult<Scraped<PortCall>> => {
    void now;

    const anchor = ANCHOR.exec(raw);
    if (!anchor) {
      return {
        ok: false,
        reason:
          "the schedule table is absent — this is not the SCC cruise schedule " +
          "(an Imperva challenge page, a redesign, or an error served with HTTP 200)",
      };
    }

    // Scoped to the anchor's own table. The page carries a weather widget and a
    // date-filter form; a document-wide row search would let either contribute.
    const after = raw.slice(anchor.index);
    const end = after.indexOf(TABLE_END);
    const table = end === -1 ? after : after.slice(0, end);

    const records: Scraped<PortCall>[] = [];
    const failures: ParseFailure[] = [];
    for (const [, row] of table.matchAll(ROW)) {
      // The header row carries `<th>` and no labelled `<td>`, so it produces no
      // cells at all — skipped without a rule that could mistake a real row for it.
      if (!/<td\b/.test(row!)) continue;

      const outcome = parseRow(row!);
      if ("record" in outcome) records.push(outcome.record);
      else failures.push(outcome.failure);
    }

    // Anchor present with zero rows lands here as `records: []` — a genuinely
    // quiet window is a fact about the source, not a failure to read it.
    return { ok: true, records, failures };
  },
};
