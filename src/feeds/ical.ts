import type { Instant } from "../domain/instant.js";
import type { CalendarEntry } from "../domain/types.js";

/**
 * The iCal serializer — a deliberately **reduced** projection, not a faithful one.
 *
 * The surviving property set across all three major clients is exactly seven:
 * `UID`, `DTSTAMP`, `DTSTART`, `DTEND`, `SUMMARY`, `DESCRIPTION`, `LOCATION`.
 * `CATEGORIES` and `URL` are standard RFC 5545 properties and each survives on
 * only 1 of 3; `X-` properties are allowlisted per vendor, so there is no
 * friendlier namespace to escape into. **Standards conformance does not imply
 * survival**, which is why attribution and category travel as prose inside
 * `SUMMARY` / `DESCRIPTION` instead (ADR-0001, #6).
 *
 * **`SEQUENCE` is absent on purpose** — it is not an oversight to fix. The
 * domain model stores and bumps it, but these feeds carry no `METHOD`, and
 * `SEQUENCE` is what a client consults on an iTIP *invitation*, not on a
 * subscribed calendar it refetches and reconciles by `UID`. A reschedule
 * propagates as a changed `DTSTART` under an unchanged `UID` either way. See
 * ADR-0008 §5, which also records the reopen trigger.
 *
 * Nothing here says anything about staleness (#17). Every in-feed mechanism is
 * ugly — mutating individually-accurate records' text and churning `SEQUENCE`
 * daily, or injecting a phantom marker entry. Freshness is disclosed on the web
 * calendar, per source, instead.
 */

const CRLF = "\r\n";

/**
 * Asia/Singapore as a **static literal**. Fixed +08:00 with no DST since 1982,
 * so the zone needs no library and cannot drift — the one transition it has ever
 * had is the 1982 move off +07:30, which is written out below.
 *
 * Every `DATE-TIME` in this feed is nonetheless a UTC instant with a `Z` suffix
 * (ADR-0003). The block is here as the honest statement of the market the data
 * describes, not as a `TZID` any property references.
 */
const VTIMEZONE = [
  "BEGIN:VTIMEZONE",
  "TZID:Asia/Singapore",
  "BEGIN:STANDARD",
  "DTSTART:19820101T000000",
  "TZOFFSETFROM:+0730",
  "TZOFFSETTO:+0800",
  "TZNAME:+08",
  "END:STANDARD",
  "END:VTIMEZONE",
];

/** `2026-07-17T04:00:00Z` → `20260717T040000Z`. */
const asIcalUtc = (value: Instant): string => value.replace(/[-:]/g, "");

/**
 * RFC 5545 §3.3.11. `:` is deliberately **not** escaped — it is only special in
 * a property *name*, and escaping it here would corrupt any venue with a colon
 * in its name.
 */
const escapeText = (value: string): string =>
  value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");

/**
 * RFC 5545 §3.1 content lines are folded at 75 **octets**, not characters.
 *
 * Counted in bytes and split on a character boundary: a venue name carrying a
 * non-ASCII character would otherwise be cut mid-codepoint and reach the
 * subscriber as mojibake.
 */
const fold = (line: string): string[] => {
  const folded: string[] = [];
  let current = "";
  let bytes = 0;

  for (const character of line) {
    const width = Buffer.byteLength(character);
    // Continuation lines cost a leading space, so their budget is one smaller.
    const limit = folded.length === 0 ? 75 : 74;
    if (bytes + width > limit) {
      folded.push(current);
      current = "";
      bytes = 0;
    }
    current += character;
    bytes += width;
  }

  folded.push(current);
  return folded.map((part, index) => (index === 0 ? part : ` ${part}`));
};

const entryLines = (entry: CalendarEntry, dtstamp: Instant): string[] => [
  "BEGIN:VEVENT",
  `UID:${entry.uid}`,
  `DTSTAMP:${asIcalUtc(dtstamp)}`,
  `DTSTART:${asIcalUtc(entry.start)}`,
  // No `+1` adjustment. That rule only ever made sense for the all-day shape
  // ADR-0003 retired; an exclusive `DTEND` is naturally correct for a timed one.
  `DTEND:${asIcalUtc(entry.end)}`,
  `SUMMARY:${escapeText(entry.summary)}`,
  `DESCRIPTION:${escapeText(entry.description)}`,
  `LOCATION:${escapeText(entry.location)}`,
  "END:VEVENT",
];

export type Calendar = {
  /**
   * The `X-WR-CALNAME` a subscriber sees in their sidebar, beside their own work
   * calendars — so it announces whose data and which market at a glance, in
   * language a hotelier reads without having seen the glossary.
   */
  name: string;
  entries: CalendarEntry[];
  /**
   * One `DTSTAMP` for the whole run. The feed carries no `METHOD`, so `DTSTAMP`
   * is the publication instant rather than a per-entry revision marker.
   */
  dtstamp: Instant;
};

export const serializeCalendar = ({ name, entries, dtstamp }: Calendar): string =>
  [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//SG Tourism Calendar//EN",
    "CALSCALE:GREGORIAN",
    `X-WR-CALNAME:${escapeText(name)}`,
    ...VTIMEZONE,
    ...entries.flatMap((entry) => entryLines(entry, dtstamp)),
    "END:VCALENDAR",
  ]
    .flatMap(fold)
    .map((line) => `${line}${CRLF}`)
    .join("");
