import { instant } from "../domain/instant.js";
import type { Scraped, SourceKey, VenueEvent } from "../domain/types.js";
import type { FetchDeps, ParseFailure, ParseResult, Source } from "./types.js";

/**
 * Suntec Singapore Convention & Exhibition Centre.
 *
 * One server-rendered GET returns the whole ~3-month publishing window — 178
 * rows on 2026-07-20, no pagination. Nothing here needs a browser, and this
 * adapter is not offered one.
 *
 * **Timing comes from the Google Calendar export link, and only from there.**
 * That is the decision this module turns on, so it is stated once, here:
 *
 * - The visible `<time>` elements carry a **date-only** `datetime` attribute,
 *   with the clock time sitting in the text node beside it. A parser reading the
 *   attribute — the obvious, well-behaved thing to read — silently produces
 *   midnight and passes every test that does not know to look.
 * - The gcal link carries a full UTC interval,
 *   `dates=20260717T040000Z/20260718T140000Z`, well-formed on 178 of 178 rows,
 *   plus a hall-level location string.
 * - Squarespace's own `?format=ical` and `?format=json` endpoints would be
 *   easier still and are **`robots.txt`-disallowed for every agent**. The gcal
 *   link reaches the same facts from the ordinary page, so honouring
 *   `robots.txt` costs nothing.
 *
 * Nothing beyond facts is read. The `eventlist-description` block is present on
 * every row and populated on roughly 8% of them; it is copyrightable expression
 * and there is no field on `VenueEvent` for it to land in.
 */

const LISTING_URL = "https://www.suntecsingapore.com/visit-events";

/**
 * The venue is a **constant, not a scraped value**. The row publishes the
 * building's marketing name (`Suntec Singapore Convention &amp; Exhibition
 * Centre`); the model names the place, and one adapter means one venue by
 * construction. Scraping it would let a copy edit rename a venue mid-history.
 */
const VENUE = "Suntec Convention Centre";

/**
 * The structural anchor (ADR-0006), checked before any row is examined.
 *
 * It is the listing **container**, not a row — deliberately, because the two
 * states this has to separate are *empty listing* and *not our document*, and a
 * row selector cannot tell them apart: both yield zero rows. The container is
 * rendered by Squarespace whether or not it has anything in it, so its presence
 * is exactly the claim "we are looking at Suntec's events listing."
 *
 * `eventlist` is matched as a **whole class token**, bounded by whitespace or
 * the closing quote. A `\b` boundary would also match `eventlist-event` — the
 * row class — and an anchor satisfied by a row is no anchor at all: it would
 * report a document that had lost its listing container as a partial success.
 */
const ANCHOR = /<div[^>]*\bclass="(?:[^"]*\s)?eventlist(?:\s[^"]*)?"/;

/** Rows are split on the opening tag: `</article>` may not be reliably balanced. */
const ROW_BOUNDARY = /(?=<article[^>]*\bclass="[^"]*\beventlist-event\b)/;
const IS_ROW = /<article[^>]*\bclass="[^"]*\beventlist-event\b/;

/** `dates=20260717T040000Z/20260718T140000Z` inside the gcal export href. */
const GCAL_DATES = /[?&]dates=(\d{8}T\d{6}Z)\/(\d{8}T\d{6}Z)/;
const GCAL_LOCATION = /[?&]location=([^"&]*)/;

/**
 * The `sourceKey`: the slug from the detail URL — `cellar-fiesta-2026`,
 * `bni-vision2172026`. Matched without a query string, so it is read from the
 * detail link and never from the `?format=ical` link sitting in the same row.
 *
 * **Its stability is an assumption, and an unverified one.** Some slugs embed a
 * date (`bni-vision2172026` = 21/7/2026). A Squarespace slug is frozen at
 * creation rather than re-derived, so it *should* survive a reschedule — but
 * that has not been observed. If the assumption is wrong, a rescheduled event
 * arrives as a delete-plus-create instead of a move: a new `uid`, a duplicate
 * beside a stale entry, and the update a subscriber most needs delivered as the
 * one thing it is not.
 *
 * It is contained here on purpose. `sourceKey` is opaque to the core (ADR-0004),
 * so if this proves wrong the blast radius is this constant and the rule below
 * it — nothing downstream inspects the key, and no other module has to agree.
 */
const DETAIL_SLUG = /href="\/visit-events\/([^"?#]+)"/;

const TITLE = /<a[^>]*class="[^"]*\beventlist-title-link\b[^"]*"[^>]*>([\s\S]*?)<\/a>/;

/**
 * The gcal `location` is the street address, the hall, and the country, joined
 * by commas: `1 Raffles Boulevard Suntec City, Level 4, Hall 404, Singapore`.
 * Only the middle is the hall — the address is the venue, already a constant,
 * and repeating it in `hall` would print it twice in every `LOCATION` line.
 */
const ADDRESS_PREFIX = "1 Raffles Boulevard Suntec City";
const COUNTRY_SUFFIX = "Singapore";

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  // Escaped, not literal: a bare apostrophe inside a double-quoted string
  // desynchronises the quote-pairing the architecture guard does when it strips
  // literals, and everything after it in this file reads as code to that guard.
  apos: "\u0027",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

const decodeEntities = (value: string): string =>
  value.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body.startsWith("#x") || body.startsWith("#X")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });

/** Tags out, entities decoded, runs of whitespace — including `&nbsp;` — collapsed. */
const textOf = (html: string): string =>
  decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();

/**
 * `%20` decoding can throw on a malformed sequence, which would take the whole
 * scrape down over one bad row. A row that cannot be decoded is a row that
 * failed, which is a thing this parser already knows how to report.
 */
const decodeParam = (value: string): string | null => {
  try {
    return decodeEntities(decodeURIComponent(value.replace(/\+/g, " ")));
  } catch {
    return null;
  }
};

/** `20260717T040000Z` → `2026-07-17T04:00:00Z`, via the branded constructor. */
const instantFromCompactUtc = (compact: string) =>
  instant(
    `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` +
      `T${compact.slice(9, 11)}:${compact.slice(11, 13)}:${compact.slice(13, 15)}Z`,
  );

/**
 * `1 Raffles Boulevard Suntec City, Level 4, Hall 404, Singapore` →
 * `Level 4, Hall 404`; the address-only form yields `null`.
 *
 * Nullable rather than defaulted: 90 of the 178 rows publish no hall at all, and
 * inventing one would be a fabrication in the field a planner reads to find the
 * room.
 */
const hallFrom = (location: string): string | null => {
  const parts = location
    .split(",")
    .map((part) => part.replace(/\s+/g, " ").trim())
    .filter((part) => part.length > 0);

  const inner = parts.filter(
    (part) => part !== ADDRESS_PREFIX && part !== COUNTRY_SUFFIX,
  );

  return inner.length > 0 ? inner.join(", ") : null;
};

/**
 * One row → one record, or one failure. Never neither, and never a partial
 * record with a guessed field: every field below is either read from the row or
 * is the reason the row is reported as broken.
 */
const parseRow = (
  row: string,
): { record: Scraped<VenueEvent> } | { failure: ParseFailure } => {
  const slug = DETAIL_SLUG.exec(row)?.[1];
  const sourceKey = slug as SourceKey | undefined;

  /** The fragment travels with the failure so it is debuggable without re-scraping. */
  const failed = (expected: string) => ({
    failure: { ...(sourceKey ? { sourceKey } : {}), fragment: row.trim(), expected },
  });

  if (!sourceKey) {
    return failed("a detail link matching /visit-events/<slug>, to key the record");
  }

  const dates = GCAL_DATES.exec(row);
  if (!dates) {
    return failed(
      "a Google Calendar export link carrying dates=<start>/<end> as UTC instants",
    );
  }

  const title = TITLE.exec(row);
  const name = title ? textOf(title[1]!) : "";
  if (!name) return failed("a non-empty eventlist-title-link, for the name");

  const rawLocation = GCAL_LOCATION.exec(row)?.[1];
  const location = rawLocation === undefined ? null : decodeParam(rawLocation);
  if (location === null) {
    return failed("a decodable location parameter on the Google Calendar link");
  }

  let start;
  let end;
  try {
    start = instantFromCompactUtc(dates[1]!);
    end = instantFromCompactUtc(dates[2]!);
  } catch {
    // `instant` refuses an impossible date rather than rolling it over into a
    // plausible one, so this arm is a real published-garbage case, not dead code.
    return failed(`a real UTC interval, but got dates=${dates[1]}/${dates[2]}`);
  }

  return {
    record: { source: suntec.key, sourceKey, name, start, end, venue: VENUE, hall: hallFrom(location) },
  };
};

export const suntec: Source<VenueEvent, string> = {
  key: "suntec",

  /**
   * One GET, through the injected client. The core owns user agent, rate limit,
   * timeout and retry, so politeness here is structural: this adapter has no
   * other route to the network, and `deps.browser` is not destructured because
   * a server-rendered page has no use for one.
   */
  fetch: async ({ http }: FetchDeps) => http.get(LISTING_URL),

  /**
   * Pure. `now` is accepted because the seam injects it, and is deliberately
   * unused: Suntec publishes absolute UTC instants, so no field here is relative
   * to the moment of reading, and the fixtures cannot drift as they age past the
   * publishing window. Naming it `_now` would suggest an oversight; this note is
   * the honest version.
   */
  parse: (raw: string): ParseResult<Scraped<VenueEvent>> => {
    if (!ANCHOR.test(raw)) {
      return {
        ok: false,
        reason:
          "the eventlist container is absent — this is not the Suntec listing page " +
          "(a redesign, a challenge page, or an error served with HTTP 200)",
      };
    }

    const rows = raw.split(ROW_BOUNDARY).filter((chunk) => IS_ROW.test(chunk));

    const records: Scraped<VenueEvent>[] = [];
    const failures: ParseFailure[] = [];
    for (const row of rows) {
      const outcome = parseRow(row);
      if ("record" in outcome) records.push(outcome.record);
      else failures.push(outcome.failure);
    }

    // Anchor present with zero rows lands here as `records: []` — a genuinely
    // quiet window is a fact about the source, not a failure to read it.
    return { ok: true, records, failures };
  },
};
