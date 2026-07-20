import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { instant, type Instant } from "../domain/instant.js";
import type { PortCall, Scraped, Terminal, VenueEvent } from "../domain/types.js";

/**
 * The pipeline's memory — a SQLite file committed to the repo (git-as-database,
 * chosen because a connection string is a credential and the zero-credentials
 * property is load-bearing).
 *
 * **The adapter observes; the core remembers.** Everything an adapter
 * structurally cannot know lives here and only here: `uid` minting, `sequence`
 * diffing, and seen-tracking. Writing it once — rather than once per record
 * type — is what keeps the two types behaving identically under the rules in
 * `CONTEXT.md`.
 */

/**
 * Identity is `(source, sourceKey)` — never the key alone. The three sources
 * cannot agree on what a key is, and duplicates across sources are accepted and
 * labelled rather than merged (ADR-0004), so the pair is the only honest
 * primary key.
 *
 * There is deliberately **no status, state, or deleted column.** Absence is an
 * observation, not a verdict; a column here would be the first place that
 * refusal leaked. Records are never hard-deleted, so nothing needs one.
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS venue_event (
    source        TEXT    NOT NULL,
    source_key    TEXT    NOT NULL,
    uid           TEXT    NOT NULL UNIQUE,
    sequence      INTEGER NOT NULL,
    name          TEXT    NOT NULL,
    start_at      TEXT    NOT NULL,
    end_at        TEXT    NOT NULL,
    venue         TEXT    NOT NULL,
    hall          TEXT,
    first_seen_at TEXT    NOT NULL,
    last_seen_at  TEXT    NOT NULL,
    PRIMARY KEY (source, source_key)
  );

  CREATE TABLE IF NOT EXISTS port_call (
    source        TEXT    NOT NULL,
    source_key    TEXT    NOT NULL,
    uid           TEXT    NOT NULL UNIQUE,
    sequence      INTEGER NOT NULL,
    vessel        TEXT    NOT NULL,
    terminal      TEXT    NOT NULL,
    berth         TEXT,
    arrival_at    TEXT    NOT NULL,
    departure_at  TEXT    NOT NULL,
    first_seen_at TEXT    NOT NULL,
    last_seen_at  TEXT    NOT NULL,
    PRIMARY KEY (source, source_key)
  );

  CREATE INDEX IF NOT EXISTS venue_event_end_at ON venue_event (end_at);
  CREATE INDEX IF NOT EXISTS port_call_departure_at ON port_call (departure_at);
`;

/** The columns that carry what the source published, in serialization order. */
type ContentColumns<T> = ReadonlyArray<readonly [column: string, field: keyof Scraped<T>]>;

type TableSpec<T extends VenueEvent | PortCall> = {
  readonly table: string;
  readonly content: ContentColumns<T>;
};

const VENUE_EVENT: TableSpec<VenueEvent> = {
  table: "venue_event",
  content: [
    ["name", "name"],
    ["start_at", "start"],
    ["end_at", "end"],
    ["venue", "venue"],
    ["hall", "hall"],
  ],
};

const PORT_CALL: TableSpec<PortCall> = {
  table: "port_call",
  content: [
    ["vessel", "vessel"],
    ["terminal", "terminal"],
    ["berth", "berth"],
    ["arrival_at", "arrival"],
    ["departure_at", "departure"],
  ],
};

/** Every content field is a string or an absent value, which is what lets one upsert serve both types. */
type StoredValue = string | null;

type Row = Record<string, StoredValue | number>;

/**
 * A `uid` is **durable state, not a function of content.** Every candidate hash
 * input is mutable: hash the title and a typo fix duplicates the record; hash
 * the start and a *rescheduled* conference duplicates rather than moves —
 * precisely the change subscribers most need delivered as an update.
 *
 * So it is random, minted once, and thereafter only ever looked up.
 */
const mintUid = (): string => `${randomUUID()}@sg-tourism-calendar`;

/**
 * Reading a column is a **parse, not a cast.** The database is a file committed
 * to the repo, which a human can edit and a bad merge can mangle; a column that
 * silently arrived as `null` would otherwise reach a subscriber's calendar as
 * the string `"null"`.
 */
const readText = (value: unknown): string => {
  if (typeof value !== "string") {
    throw new Error(`Expected stored text, found ${JSON.stringify(value)}.`);
  }
  return value;
};

const optionalText = (value: unknown): string | null =>
  value === null || value === undefined ? null : readText(value);

const readNumber = (value: unknown): number => {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new Error(`Expected a stored integer, found ${JSON.stringify(value)}.`);
  }
  return value;
};

/** Re-validated rather than trusted — a malformed instant must not reach a feed. */
const readInstant = (value: unknown): Instant => instant(readText(value));

const contentOf = <T extends VenueEvent | PortCall>(
  spec: TableSpec<T>,
  scraped: Scraped<T>,
): StoredValue[] =>
  spec.content.map(([, field]) => (scraped[field] ?? null) as StoredValue);

export type Store = {
  /** Every stored `VenueEvent`, oldest start first. Retention is unbounded. */
  readVenueEvents(): VenueEvent[];
  readPortCalls(): PortCall[];
  upsertVenueEvent(scraped: Scraped<VenueEvent>, seenAt: Instant): void;
  upsertPortCall(scraped: Scraped<PortCall>, seenAt: Instant): void;
  /** Every column across both tables — the seam the no-status guard asserts on. */
  columnNames(): string[];
  /** Runs `work` as one transaction, so a run either lands or does not. */
  transact(work: () => void): void;
  close(): void;
};

export const openStore = (path: string): Store => {
  mkdirSync(dirname(path), { recursive: true });
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.exec(SCHEMA);

  /**
   * Upsert by `(source, sourceKey)`.
   *
   * Three rules, applied here once for both record types:
   *
   * - **First sight** mints a `uid` and fixes `firstSeenAt`.
   * - **Same key, changed content** keeps the `uid` and bumps `sequence`, so a
   *   reschedule reaches a subscriber as a move rather than a duplicate.
   * - **Every sighting** advances `lastSeenAt`. A record that stops appearing is
   *   simply not passed here, so its `lastSeenAt` stops advancing — which is the
   *   whole of what absence means.
   */
  const upsert = <T extends VenueEvent | PortCall>(
    spec: TableSpec<T>,
    scraped: Scraped<T>,
    seenAt: Instant,
  ): void => {
    const columns = spec.content.map(([column]) => column);
    const values = contentOf(spec, scraped);

    const existing = db
      .prepare(`SELECT * FROM ${spec.table} WHERE source = ? AND source_key = ?`)
      .get(scraped.source, scraped.sourceKey) as Row | undefined;

    if (!existing) {
      db.prepare(
        `INSERT INTO ${spec.table}
           (source, source_key, uid, sequence, ${columns.join(", ")}, first_seen_at, last_seen_at)
         VALUES (?, ?, ?, 0, ${columns.map(() => "?").join(", ")}, ?, ?)`,
      ).run(scraped.source, scraped.sourceKey, mintUid(), ...values, seenAt, seenAt);
      return;
    }

    const changed = columns.some((column, index) => existing[column] !== values[index]);

    db.prepare(
      `UPDATE ${spec.table}
          SET sequence = ?, ${columns.map((column) => `${column} = ?`).join(", ")}, last_seen_at = ?
        WHERE source = ? AND source_key = ?`,
    ).run(
      changed ? readNumber(existing["sequence"]) + 1 : readNumber(existing["sequence"]),
      ...values,
      seenAt,
      scraped.source,
      scraped.sourceKey,
    );
  };

  return {
    readVenueEvents: () =>
      (db.prepare(`SELECT * FROM venue_event ORDER BY start_at, uid`).all() as Row[]).map(
        (row) => ({
          uid: readText(row["uid"]),
          sequence: readNumber(row["sequence"]),
          source: readText(row["source"]),
          sourceKey: readText(row["source_key"]),
          name: readText(row["name"]),
          start: readInstant(row["start_at"]),
          end: readInstant(row["end_at"]),
          venue: readText(row["venue"]),
          hall: optionalText(row["hall"]),
          firstSeenAt: readInstant(row["first_seen_at"]),
          lastSeenAt: readInstant(row["last_seen_at"]),
        }),
      ),

    readPortCalls: () =>
      (db.prepare(`SELECT * FROM port_call ORDER BY arrival_at, uid`).all() as Row[]).map(
        (row) => ({
          uid: readText(row["uid"]),
          sequence: readNumber(row["sequence"]),
          source: readText(row["source"]),
          sourceKey: readText(row["source_key"]),
          vessel: readText(row["vessel"]),
          terminal: readText(row["terminal"]) as Terminal,
          berth: optionalText(row["berth"]),
          arrival: readInstant(row["arrival_at"]),
          departure: readInstant(row["departure_at"]),
          firstSeenAt: readInstant(row["first_seen_at"]),
          lastSeenAt: readInstant(row["last_seen_at"]),
        }),
      ),

    upsertVenueEvent: (scraped, seenAt) => upsert(VENUE_EVENT, scraped, seenAt),
    upsertPortCall: (scraped, seenAt) => upsert(PORT_CALL, scraped, seenAt),

    columnNames: () =>
      [VENUE_EVENT.table, PORT_CALL.table].flatMap((table) =>
        (db.pragma(`table_info(${table})`) as { name: string }[]).map((column) => column.name),
      ),

    transact: (work) => {
      db.transaction(work)();
    },

    close: () => db.close(),
  };
};
