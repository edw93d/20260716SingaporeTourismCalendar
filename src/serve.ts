import { SITE_DIR } from "./paths.js";
import { createCalendarServer } from "./server/server.js";
import { openStore } from "./store/store.js";

/**
 * The public read surface's entry point (#154, ADR-0025 §4). The second — and
 * only other — place in this repository that reads the environment: it names the
 * Postgres connection string once, out loud, exactly as `main.ts` does for the
 * daily run, and for the same reason (never defaulted; absent, it refuses rather
 * than improvising a database). `tests/architecture.test.ts` allows exactly these
 * two entry points and no module besides.
 *
 * The store is opened here and injected into `createCalendarServer`, which never
 * reads the environment itself — so the server is exercisable over a real socket
 * against an ephemeral store, and this file is the only thing the test cannot.
 */

const requireConnectionString = (): string => {
  const value = process.env["DATABASE_URL"];
  if (!value) {
    throw new Error("DATABASE_URL is required — the store connection is injected, never defaulted.");
  }
  return value;
};

/**
 * The port the always-on server binds. Read here beside the connection string
 * because it, too, is deployment-shaped — the host decides the port, not the code
 * — and defaulted to 8080 so a local run needs only `DATABASE_URL`.
 */
const port = Number(process.env["PORT"] ?? "8080");

const main = async (): Promise<void> => {
  const store = await openStore(requireConnectionString());
  const server = createCalendarServer({ store, siteDir: SITE_DIR });
  server.listen(port, () => {
    console.log(`Serving the calendar on :${port}`);
  });
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
