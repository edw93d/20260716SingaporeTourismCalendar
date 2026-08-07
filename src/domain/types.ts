import type { Instant } from "./instant.js";

/**
 * The domain model. Transcribed from `CONTEXT.md` § Glossary — this file
 * invents nothing, it makes the settled decisions compiler-enforced.
 *
 * ⛔ **"Event" is banned as a bare term** (`CONTEXT.md` § Event). It was doing
 * two incompatible jobs — a thing people attend, and a ship docking that nobody
 * attends — and forcing them into one schema is what produced a `description`
 * field that meant nothing. Say **VenueEvent** or **PortCall**.
 */

/**
 * Which adapter produced a record — `suntec`, `scc`, `mbccs`.
 *
 * Deliberately **not** a closed union. ADR-0005 fixes the cost of a new source
 * at **two files, the module and the registry**; a union would quietly make it
 * three by dragging in the domain model, which a new scraper is no part of.
 * Same reasoning as `SourceKey` below: the core carries the label without
 * holding an opinion on its contents.
 */
export type SourceId = string;

/** MPA confirms these are the only two, so cruise coverage is complete. */
export type Terminal = "MBCCS" | "Singapore Cruise Centre";

/**
 * Identity within a source. **Opaque** — the core stores it and never inspects
 * it, because the three sources cannot agree on what a key even is (ADR-0004).
 * Computing it is the adapter's business.
 */
export type SourceKey = string;

/**
 * What every record carries regardless of type: durable identity, provenance,
 * and observation history.
 *
 * Nullable fields are typed `| null` rather than optional. A record always has
 * the field; the source may not have published a value. That distinction
 * survives a round-trip through SQLite, where `undefined` does not.
 */
type TrackedRecord = {
  /** Durable. Minted once on first sight, never recomputed. See `CONTEXT.md` § UID. */
  uid: string;
  /** RFC 5545 `SEQUENCE`; bumped when content changes under a stable key. */
  sequence: number;
  source: SourceId;
  sourceKey: SourceKey;
  /** Observation only. Absence is never resolved into a status (ADR-0004). */
  firstSeenAt: Instant;
  lastSeenAt: Instant;
};

/**
 * Something scheduled at a venue, that people attend.
 *
 * Deliberately **not** `MiceEvent`: Suntec's listings mix business meetings
 * (BNI Vision) with consumer events (Cellar Fiesta). The honest common property
 * is that something is scheduled at a venue.
 *
 * **There is no `description` field** — see `CONTEXT.md` § Facts-only extraction.
 * The scraped blurb was ~8% populated and was copyrightable *expression* rather
 * than fact. The iCal `DESCRIPTION` property survives as prose we generate.
 */
export type VenueEvent = TrackedRecord & {
  name: string;
  start: Instant;
  end: Instant;
  venue: string;
  /** e.g. `Level 4, Hall 404`. */
  hall: string | null;
  /**
   * The two moderation flags — **person-set only, never observed** (ADR-0024,
   * ADR-0030, #155/#156). Two independent booleans: `hidden` removes the record
   * from the public calendar (filtered *before* projection, #156) and `reviewed`
   * records that a person has looked at it. Hiding does not imply reviewed, and
   * neither records *by whom* or *when* — the single-operator footing (ADR-0030).
   *
   * They live on `VenueEvent` and **not** on `PortCall`, and they are absent from
   * `Scraped<T>` below, so a scrape can neither set them nor clobber them (the
   * upsert's SET clause names only content — `src/store/store.ts`). `#155` reads
   * and renders them; `#156` makes them writable and load-bearing.
   */
  hidden: boolean;
  reviewed: boolean;
};

/**
 * The two person-set moderation flags, named as a closed union so the one place
 * that writes them — the store's `setModerationFlag`, reached only past the admin
 * auth boundary (ADR-0030 §5) — cannot be handed a column that is not a flag. It
 * is the runtime companion to `Scraped<T>`'s type-level exclusion: `Scraped<T>`
 * stops a *scrape* naming these, this stops a *toggle route* naming anything else.
 */
export type ModerationFlag = "hidden" | "reviewed";

/**
 * A ship berthing at a Singapore cruise terminal. Nobody attends it. Its value
 * to the audience is that it lands thousands of people nearby.
 *
 * Has no name and no description, because a port call has neither. A unified
 * schema would have fabricated them (ADR-0001).
 */
export type PortCall = TrackedRecord & {
  /**
   * The vessel string **as published, unsplit**. SCC concatenates ship and line
   * into one cell (`ODYSSEY / VILLA VIE RESIDENCES`) delimited by whitespace
   * only; ship names are multi-word, so no rule splits it reliably and a bad
   * split would silently corrupt `sourceKey`. MBCCS publishes no line at all.
   */
  vessel: string;
  terminal: Terminal;
  /** Pier number. Not reader-facing; demoted to the generated `description`. */
  berth: string | null;
  arrival: Instant;
  departure: Instant;
};

/** Every record in the model. There are exactly two. */
export type DomainRecord = VenueEvent | PortCall;

/**
 * The projection both types serialize through — named for its role, not its
 * meaning. It is what the web calendar, the iCal feed, and (later) Excel render.
 *
 * **A convenience, not a bottleneck.** It flattens away `vessel`, `hall` and
 * `berth`; a serializer needing those (a future Excel export) reads the domain
 * types directly.
 */
export type CalendarEntry = {
  uid: string;
  /** Carries the category as **prose** — `CATEGORIES` survives on 1 of 3 clients. */
  summary: string;
  start: Instant;
  end: Instant;
  location: string;
  /** Generated by us, never scraped. Carries attribution. */
  description: string;
  source: SourceId;
};

/**
 * What an adapter can honestly return: **observation, not memory.**
 *
 * A parser reads a page. It knows `name`, `start`, `end`, `venue`, `hall`, and
 * computes `sourceKey`. It cannot know `uid` (durable state looked up by
 * `(source, sourceKey)` — today's HTML has no access to that memory),
 * `sequence` (a comparison against stored state it has never seen), or either
 * seen-timestamp (facts about our observation history, not about the page). Nor
 * the two moderation flags (`hidden`/`reviewed`): those are person-set, not
 * observed, and a scrape that could return them could clobber them (ADR-0024).
 *
 * **The adapter observes; the core remembers.** If `parse` returned a full
 * `VenueEvent` it would have to fabricate those — including minting a `uid` on
 * *every scrape*, precisely the recompute that duplicates a rescheduled
 * conference instead of moving it, and re-asserting a `hidden` a person cleared.
 * The type makes those bugs unwritable rather than merely discouraged.
 */
export type Scraped<T> = Omit<
  T,
  "uid" | "sequence" | "firstSeenAt" | "lastSeenAt" | "hidden" | "reviewed"
>;
