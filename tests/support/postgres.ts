import { Client } from "pg";

/**
 * An **ephemeral Postgres schema per test**, so the store's SQL — the upsert-only
 * trap, the migration column-copy, the `ON CONFLICT` sequence bump — is exercised
 * against a real database rather than a fake (ADR-0025; the ticket's prior art is
 * v1's tests running against a real temp SQLite store). A fake would be exactly
 * the place those traps hide.
 *
 * Isolation is a fresh, uniquely-named schema baked into the connection string's
 * `search_path`, dropped `CASCADE` afterwards. Schemas rather than databases so
 * setup is cheap enough to run in a `beforeEach`, and the connection string stays
 * the single injected handle `openStore` takes — no second config channel.
 */

/**
 * The base connection string, from the environment. **Read directly here, not
 * through `src/`** — the architecture test's one-injection-site rule is about
 * production code (`main.ts`); a test harness pointing itself at its own throwaway
 * database is not the credential-in-a-module hazard that rule guards against. It
 * throws rather than skips when unset: the ticket requires a *real* Postgres, so a
 * silent green with no database would be the suite lying about what it verified.
 */
const base = (): string => {
  const url = process.env["TEST_DATABASE_URL"] ?? process.env["DATABASE_URL"];
  if (!url) {
    throw new Error(
      "TEST_DATABASE_URL (or DATABASE_URL) must point at an ephemeral Postgres for the store tests.",
    );
  }
  return url;
};

let counter = 0;

const withAdmin = async <T>(work: (client: Client) => Promise<T>): Promise<T> => {
  const client = new Client({ connectionString: base() });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
};

export type EphemeralStore = {
  /** A connection string scoped to this schema — hand it straight to `openStore`. */
  connectionString: string;
  /** Drops the schema and everything in it. Call in `afterEach`. */
  drop(): Promise<void>;
};

/** Creates a fresh isolated schema and returns a connection string bound to it. */
export const freshSchema = async (): Promise<EphemeralStore> => {
  const schema = `test_${process.pid}_${(counter++).toString(36)}`;
  await withAdmin((client) => client.query(`CREATE SCHEMA "${schema}"`));

  const url = new URL(base());
  url.searchParams.set("options", `-c search_path=${schema}`);

  return {
    connectionString: url.toString(),
    drop: () => withAdmin((client) => client.query(`DROP SCHEMA "${schema}" CASCADE`)).then(() => {}),
  };
};
