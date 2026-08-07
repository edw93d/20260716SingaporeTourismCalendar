import { randomUUID } from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { instant, type Instant } from "../domain/instant.js";
import type { ModerationFlag, PortCall, Scraped, Terminal, VenueEvent } from "../domain/types.js";

/**
 * The pipeline's memory — a hosted Postgres reached over an injected connection
 * string (ADR-0025). It stopped being a SQLite file committed to the repository
 * the moment there were two writers (a scrape in GitHub Actions and the admin
 * page's server) and one unbackfillable dataset (flights): a binary blob in git
 * cannot merge, and one machine cannot own a disk the other needs.
 *
 * **The connection string is injected, never defaulted** (ADR-0010's rule, whose
 * zero-credentials *property* ADR-0025 spends but whose *code shape* it keeps):
 * the entry point says the credential out loud, exactly as it says the HTTP
 * client. A store that defaulted its connection would be a module deciding for
 * its callers which database they meant to write.
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
 *
 * Instants are stored as `text`, not `timestamptz`. The migration is a column
 * copy that must leave `firstSeenAt`/`lastSeenAt` byte-for-byte untouched
 * (ADR-0025 §7), and `timestamptz` would reformat the ISO string on the way in;
 * `text` round-trips the exact bytes v1 minted, and `Instant` already sorts
 * chronologically as plain text (see `instant.ts`).
 */
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS venue_event (
    source        text    NOT NULL,
    source_key    text    NOT NULL,
    uid           text    NOT NULL UNIQUE,
    sequence      integer NOT NULL,
    name          text    NOT NULL,
    start_at      text    NOT NULL,
    end_at        text    NOT NULL,
    venue         text    NOT NULL,
    hall          text,
    hidden        boolean NOT NULL DEFAULT false,
    reviewed      boolean NOT NULL DEFAULT false,
    first_seen_at text    NOT NULL,
    last_seen_at  text    NOT NULL,
    PRIMARY KEY (source, source_key)
  );

  -- The two moderation flags (ADR-0024, ADR-0030; #155 reads them, #156 writes
  -- them). Added out of line as well as in the CREATE above so a store migrated
  -- from v1 -- whose table predates these columns -- gains them on the next open;
  -- IF NOT EXISTS makes that a no-op on a table that already has them. They
  -- default to their not-set value and port_call gets neither. The upsert never
  -- names them (its SET clause is spec.content only), so a scrape can neither
  -- set nor clear a person's judgement.
  ALTER TABLE venue_event ADD COLUMN IF NOT EXISTS hidden   boolean NOT NULL DEFAULT false;
  ALTER TABLE venue_event ADD COLUMN IF NOT EXISTS reviewed boolean NOT NULL DEFAULT false;

  CREATE TABLE IF NOT EXISTS port_call (
    source        text    NOT NULL,
    source_key    text    NOT NULL,
    uid           text    NOT NULL UNIQUE,
    sequence      integer NOT NULL,
    vessel        text    NOT NULL,
    terminal      text    NOT NULL,
    berth         text,
    arrival_at    text    NOT NULL,
    departure_at  text    NOT NULL,
    first_seen_at text    NOT NULL,
    last_seen_at  text    NOT NULL,
    PRIMARY KEY (source, source_key)
  );

  CREATE INDEX IF NOT EXISTS venue_event_end_at ON venue_event (end_at);
  CREATE INDEX IF NOT EXISTS port_call_departure_at ON port_call (departure_at);

  CREATE TABLE IF NOT EXISTS pipeline_run (
    id      boolean PRIMARY KEY DEFAULT true CHECK (id),
    ran_at  text    NOT NULL
  );
`;

/** The columns that carry what the source published, in serialization order. */
type ContentColumns<T> = ReadonlyArray<readonly [column: string, field: keyof Scraped<T>]>;

export type TableSpec<T extends VenueEvent | PortCall> = {
  readonly table: string;
  readonly content: ContentColumns<T>;
};

export const VENUE_EVENT: TableSpec<VenueEvent> = {
  table: "venue_event",
  content: [
    ["name", "name"],
    ["start_at", "start"],
    ["end_at", "end"],
    ["venue", "venue"],
    ["hall", "hall"],
  ],
};

export const PORT_CALL: TableSpec<PortCall> = {
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

/** A read row. `boolean` for the moderation flag columns, alongside text and the integer `sequence`. */
type Row = Record<string, StoredValue | number | boolean>;

/** Both a `Pool` and a transaction-bound `PoolClient` answer this — the store is written once against it. */
type Queryable = {
  query(text: string, params?: unknown[]): Promise<{ rows: Row[] }>;
};

/**
 * A `uid` is **durable state, not a function of content.** Every candidate hash
 * input is mutable: hash the title and a typo fix duplicates the record; hash
 * the start and a *rescheduled* conference duplicates rather than moves —
 * precisely the change subscribers most need delivered as an update.
 *
 * So it is random, minted once, and thereafter only ever looked up. It is minted
 * for every upsert and discarded on conflict, which is harmless: a random value
 * that is thrown away is not a recompute — only a *content-derived* uid would be.
 */
const mintUid = (): string => `${randomUUID()}@sg-tourism-calendar`;

/**
 * Reading a column is a **parse, not a cast.** A store a human can reach and a
 * bad migration can mangle must not let a column that silently arrived as `null`
 * reach a subscriber's calendar as the string `"null"`.
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

/**
 * A stored boolean read as a parse, not a cast — the `NOT NULL DEFAULT false`
 * flag columns. `pg` maps a Postgres `boolean` to a JS boolean, so anything else
 * is a column that arrived malformed (a bad migration, a hand-edit), which must
 * not reach the admin table as a truthy `"f"` string.
 */
const readBoolean = (value: unknown): boolean => {
  if (typeof value !== "boolean") {
    throw new Error(`Expected a stored boolean, found ${JSON.stringify(value)}.`);
  }
  return value;
};

/** Re-validated rather than trusted — a malformed instant must not reach a reader. */
const readInstant = (value: unknown): Instant => instant(readText(value));

const contentOf = <T extends VenueEvent | PortCall>(
  spec: TableSpec<T>,
  scraped: Scraped<T>,
): StoredValue[] =>
  spec.content.map(([, field]) => (scraped[field] ?? null) as StoredValue);

/**
 * Every read and write, reachable over the network so every method resolves a
 * promise. The seam is v1's exactly — `readVenueEvents`, `readPortCalls`,
 * `upsert*`, `transact`, `close` — because the pipeline above it never learned
 * the store was a file, and must not learn it is now a service.
 */
export type Store = {
  /** Every stored `VenueEvent`, oldest start first. Retention is unbounded. */
  readVenueEvents(): Promise<VenueEvent[]>;
  readPortCalls(): Promise<PortCall[]>;
  upsertVenueEvent(scraped: Scraped<VenueEvent>, seenAt: Instant): Promise<void>;
  upsertPortCall(scraped: Scraped<PortCall>, seenAt: Instant): Promise<void>;
  /**
   * Sets one moderation flag on the `VenueEvent` with this `uid` to `value`
   * (ADR-0024, ADR-0030; #156). This is the **only** write that touches a
   * moderation column — the upsert names none of them — so a person's judgement
   * and a scrape's content can never overwrite one another.
   *
   * The two flags are **independent**: this sets exactly the one named and leaves
   * the other untouched, so hiding never implies reviewed (ADR-0024 §2). It is
   * genuinely reversible — the same call with the opposite `value` restores the
   * prior state, minting and retiring nothing (ADR-0024 §7).
   *
   * Returns whether a row matched: `false` is an unknown `uid`, which the toggle
   * route answers as a 404 rather than a silent success. `PortCall` carries no
   * flags, so there is deliberately no port-call counterpart (ADR-0024 §2).
   */
  setModerationFlag(uid: string, flag: ModerationFlag, value: boolean): Promise<boolean>;
  /**
   * Stamps the store with the instant this run completed — the payload's
   * `generatedAt` (ADR-0013, #154). v1 baked it into a committed `calendar.json`;
   * v2's pipeline publishes nothing and the server builds the payload live, so
   * the run instant lives here instead, written once per run and read back on
   * every request.
   *
   * **Advances on any completed run, including one that confirmed no source.**
   * Freshness is a property of the publish, not of any source — reading a
   * source's `lastSeenAt` instead would freeze the moment a scraper broke and
   * fire the alarm on a run that published perfectly on time (CONTEXT.md §
   * Freshness). One marker, overwritten each run — `lastRun` is the latest, not
   * a log.
   */
  recordRun(ranAt: Instant): Promise<void>;
  /**
   * The most recent recorded run, or `null` before any run has completed. The
   * server serves the latter as a payload with no `generatedAt`, which the
   * freshness alarm reads as *not yet published* rather than as a stale calendar.
   */
  lastRun(): Promise<Instant | null>;
  /**
   * Runs `work` as one transaction — so a source either lands whole or not at
   * all (ADR-0025 §5). The `tx` handed in is the same `Store`, bound to the
   * transaction's connection; writes made through it commit or roll back
   * together. Reads and the outer store's own `upsert*` still work, each as its
   * own implicit transaction.
   */
  transact(work: (tx: Store) => Promise<void>): Promise<void>;
  close(): Promise<void>;
};

/**
 * Upsert by `(source, sourceKey)` in **one statement**.
 *
 * ⚠️ **The trap ADR-0025 §5 names: the write must touch only the columns an
 * adapter observed — exactly the fields of `Scraped<T>`.** A person-set flag
 * (`hidden`/`reviewed`, arriving with #4) that a scrape overwrote would un-do
 * every moderation judgement ever made, silently, on the next run. So the
 * `SET` clause below is built *only* from `spec.content`, `sequence` and
 * `last_seen_at`: `uid` and `first_seen_at` are set on insert and never on
 * conflict, and a moderation column is named nowhere at all — unwritable in SQL
 * as `Scraped<T>` makes it unwritable in the type. `SELECT *`-style column
 * copying is exactly what this avoids.
 *
 * Three rules, applied here once for both record types:
 *
 * - **First sight** (`INSERT`) mints a `uid` and fixes `first_seen_at`.
 * - **Same key, changed content** keeps the `uid` and bumps `sequence` — the
 *   `CASE` fires only when some content column `IS DISTINCT FROM` the value
 *   proposed — so a reschedule reaches a subscriber as a move rather than a
 *   duplicate. `sequence` is recorded but deliberately not serialized (ADR-0008
 *   §5); the move is carried by the stable `uid`.
 * - **Every sighting** advances `last_seen_at`. A record that stops appearing is
 *   simply not passed here, so its `last_seen_at` stops advancing — which is the
 *   whole of what absence means.
 */
const upsert = async <T extends VenueEvent | PortCall>(
  db: Queryable,
  spec: TableSpec<T>,
  scraped: Scraped<T>,
  seenAt: Instant,
): Promise<void> => {
  const columns = spec.content.map(([column]) => column);
  const values = contentOf(spec, scraped);

  // $1 source, $2 source_key, $3 uid, then one placeholder per content column,
  // then $seen for both first_seen_at and last_seen_at.
  const contentPlaceholders = columns.map((_, i) => `$${i + 4}`);
  const seenPlaceholder = `$${columns.length + 4}`;

  const changed = columns
    .map((column) => `${spec.table}.${column} IS DISTINCT FROM EXCLUDED.${column}`)
    .join(" OR ");

  await db.query(
    `INSERT INTO ${spec.table}
       (source, source_key, uid, sequence, ${columns.join(", ")}, first_seen_at, last_seen_at)
     VALUES ($1, $2, $3, 0, ${contentPlaceholders.join(", ")}, ${seenPlaceholder}, ${seenPlaceholder})
     ON CONFLICT (source, source_key) DO UPDATE SET
       ${columns.map((column) => `${column} = EXCLUDED.${column}`).join(", ")},
       sequence = ${spec.table}.sequence + (CASE WHEN ${changed} THEN 1 ELSE 0 END),
       last_seen_at = EXCLUDED.last_seen_at`,
    [scraped.source, scraped.sourceKey, mintUid(), ...values, seenAt],
  );
};

/**
 * The identity-and-observation fields every stored record carries, read once for
 * both types. These are the core's own — minted and tracked here, never observed
 * — so they map identically whichever table the row came from; only the content
 * columns differ.
 */
const trackedOf = (row: Row) => ({
  uid: readText(row["uid"]),
  sequence: readNumber(row["sequence"]),
  source: readText(row["source"]),
  sourceKey: readText(row["source_key"]),
  firstSeenAt: readInstant(row["first_seen_at"]),
  lastSeenAt: readInstant(row["last_seen_at"]),
});

const readVenueEvents = async (db: Queryable): Promise<VenueEvent[]> => {
  const { rows } = await db.query(`SELECT * FROM venue_event ORDER BY start_at, uid`);
  return rows.map((row) => ({
    ...trackedOf(row),
    name: readText(row["name"]),
    start: readInstant(row["start_at"]),
    end: readInstant(row["end_at"]),
    venue: readText(row["venue"]),
    hall: optionalText(row["hall"]),
    hidden: readBoolean(row["hidden"]),
    reviewed: readBoolean(row["reviewed"]),
  }));
};

const readPortCalls = async (db: Queryable): Promise<PortCall[]> => {
  const { rows } = await db.query(`SELECT * FROM port_call ORDER BY arrival_at, uid`);
  return rows.map((row) => ({
    ...trackedOf(row),
    vessel: readText(row["vessel"]),
    terminal: readText(row["terminal"]) as Terminal,
    berth: optionalText(row["berth"]),
    arrival: readInstant(row["arrival_at"]),
    departure: readInstant(row["departure_at"]),
  }));
};

/**
 * The flag name mapped to its column, an **allowlist**: the only two strings that
 * ever reach the SQL below, so the column is never interpolated from anything a
 * request supplied. `ModerationFlag` already bounds the type; this bounds the
 * value at runtime too, because the string arrives from an HTTP body the type
 * system never saw. An unknown flag throws rather than building a statement.
 */
const MODERATION_COLUMN: Record<ModerationFlag, string> = {
  hidden: "hidden",
  reviewed: "reviewed",
};

/**
 * Flips one moderation flag on one `VenueEvent`, by `uid`. A single-column
 * `UPDATE` — it names only the one flag, so the other stays exactly as it was
 * (independence, ADR-0024 §2). `RETURNING uid` lets the caller tell a real toggle
 * from an unknown `uid` (no row → `false` → the route's 404) without a second
 * round trip.
 */
const setModerationFlag = async (
  db: Queryable,
  uid: string,
  flag: ModerationFlag,
  value: boolean,
): Promise<boolean> => {
  const column = MODERATION_COLUMN[flag];
  if (column === undefined) throw new Error(`Not a moderation flag: ${JSON.stringify(flag)}.`);
  const { rows } = await db.query(
    `UPDATE venue_event SET ${column} = $1 WHERE uid = $2 RETURNING uid`,
    [value, uid],
  );
  return rows.length > 0;
};

/**
 * The single-row run-marker. `id` is a constant `true` under a `CHECK (id)` and
 * `PRIMARY KEY`, so the table holds at most one row — the upsert can conflict on
 * a fixed key rather than on any run detail, and there is no way to accumulate a
 * log by accident. Every run overwrites `ran_at`.
 */
const recordRun = async (db: Queryable, ranAt: Instant): Promise<void> => {
  await db.query(
    `INSERT INTO pipeline_run (id, ran_at) VALUES (true, $1)
     ON CONFLICT (id) DO UPDATE SET ran_at = EXCLUDED.ran_at`,
    [ranAt],
  );
};

/** The recorded run instant, re-validated on the way out, or `null` if none. */
const lastRun = async (db: Queryable): Promise<Instant | null> => {
  const { rows } = await db.query(`SELECT ran_at FROM pipeline_run WHERE id = true`);
  const row = rows[0];
  return row === undefined ? null : readInstant(row["ran_at"]);
};

/**
 * The store bound to one `Queryable` — the pool, or a transaction's client.
 *
 * The `transact` handed in is the pool-level one, so a `tx.transact(...)` called
 * on a transaction handle would open a *fresh* pooled connection rather than nest
 * — it is not a real nested transaction, and no caller does it (run.ts calls
 * `transact` once per source and only `upsert*` inside). It is on the type only
 * because `tx` is a full `Store`.
 */
const storeOver = (db: Queryable, transact: Store["transact"]): Store => ({
  readVenueEvents: () => readVenueEvents(db),
  readPortCalls: () => readPortCalls(db),
  upsertVenueEvent: (scraped, seenAt) => upsert(db, VENUE_EVENT, scraped, seenAt),
  upsertPortCall: (scraped, seenAt) => upsert(db, PORT_CALL, scraped, seenAt),
  setModerationFlag: (uid, flag, value) => setModerationFlag(db, uid, flag, value),
  recordRun: (ranAt) => recordRun(db, ranAt),
  lastRun: () => lastRun(db),
  transact,
  close: async () => {},
});

/**
 * Opens the store against `connectionString` and ensures the schema exists.
 *
 * **Required, and deliberately not defaulted** — the argument has no default and
 * no fallback to the environment (ADR-0025; the entry point reads the string and
 * passes it). A pool is created eagerly and connects lazily; `close()` drains it.
 */
export const openStore = async (connectionString: string): Promise<Store> => {
  const pool = new Pool({ connectionString });
  await pool.query(SCHEMA);

  // Each transaction owns a dedicated client so its `BEGIN`/`COMMIT` cannot
  // interleave with another caller's work on a pooled connection. Postgres
  // readers do not block writers and writers do not block readers (ADR-0025 §5),
  // so a scrape's per-source transaction and a moderator's flag toggle are
  // ordinary concurrent transactions needing no isolation level above the
  // default.
  const transact: Store["transact"] = async (work) => {
    const client: PoolClient = await pool.connect();
    try {
      await client.query("BEGIN");
      await work(storeOver(client, transact));
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  };

  return {
    ...storeOver(pool, transact),
    close: async () => {
      await pool.end();
    },
  };
};
