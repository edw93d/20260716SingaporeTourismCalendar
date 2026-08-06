import Database from "better-sqlite3";
import { Pool } from "pg";
import type { PortCall, VenueEvent } from "../domain/types.js";
import { PORT_CALL, VENUE_EVENT, openStore, type TableSpec } from "./store.js";

/**
 * The one-time move of v1's store into Postgres (ADR-0025 §7).
 *
 * ⚠️ **Every record moves, and every UID moves with it — untouched.** ADR-0004
 * mints a `uid` once on first sight and never recomputes it, and this is not
 * theoretical: v1's public Pages feed served real UIDs to real subscribers, so a
 * migration that re-minted would replace every entry in anything subscribed.
 * Preserving them costs nothing — it is a column copy — and it is what lets v3
 * turn the feeds back on without every calendar being deleted and rebuilt.
 *
 * So this does **not** go through the scrape `upsert`, which mints a `uid` and
 * resets `first_seen_at` on insert. It copies `source`, `source_key`, `uid`,
 * `sequence`, the content columns, `first_seen_at` and `last_seen_at` verbatim.
 * The v1 blob is read straight from git history (it was removed from the working
 * tree at #147): `git show <ref>:data/calendar.sqlite > <tmp>` and pass the temp
 * path here. `better-sqlite3` survives as a dev dependency for exactly this — the
 * runtime store speaks Postgres and nothing else.
 */

/** The full column set, in copy order: identity, the core-owned fields, and content. */
const columnsOf = <T extends VenueEvent | PortCall>(spec: TableSpec<T>): string[] => [
  "source",
  "source_key",
  "uid",
  "sequence",
  ...spec.content.map(([column]) => column),
  "first_seen_at",
  "last_seen_at",
];

const copyTable = async <T extends VenueEvent | PortCall>(
  v1: Database.Database,
  pool: Pool,
  spec: TableSpec<T>,
): Promise<number> => {
  const columns = columnsOf(spec);
  const rows = v1.prepare(`SELECT ${columns.join(", ")} FROM ${spec.table}`).all() as Record<
    string,
    unknown
  >[];

  for (const row of rows) {
    // ON CONFLICT DO NOTHING, not DO UPDATE: re-running the migration must never
    // touch a row already carried across — least of all its uid. Preservation is
    // the whole point, so a second run is a no-op rather than a re-copy.
    await pool.query(
      `INSERT INTO ${spec.table} (${columns.join(", ")})
       VALUES (${columns.map((_, i) => `$${i + 1}`).join(", ")})
       ON CONFLICT (source, source_key) DO NOTHING`,
      columns.map((column) => row[column]),
    );
  }

  return rows.length;
};

/**
 * Copies every row of a v1 SQLite store at `sqlitePath` into the Postgres store
 * at `connectionString`, minting nothing. Returns how many of each type moved.
 */
export const migrateFromV1 = async (
  sqlitePath: string,
  connectionString: string,
): Promise<{ venueEvents: number; portCalls: number }> => {
  // `openStore` first, so the schema exists before anything is copied into it.
  const store = await openStore(connectionString);
  await store.close();

  const v1 = new Database(sqlitePath, { readonly: true });
  const pool = new Pool({ connectionString });
  try {
    const venueEvents = await copyTable(v1, pool, VENUE_EVENT);
    const portCalls = await copyTable(v1, pool, PORT_CALL);
    return { venueEvents, portCalls };
  } finally {
    v1.close();
    await pool.end();
  }
};
