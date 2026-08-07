import { SITE_DIR } from "./paths.js";
import { createCalendarServer } from "./server/server.js";
import { openStore } from "./store/store.js";

/**
 * The public read surface and admin server's entry point (#154, #155,
 * ADR-0025 §4, ADR-0030). The second — and only other — place in this repository
 * that reads the environment: it names the Postgres connection string and the
 * admin secret out loud, exactly as `main.ts` names the connection string for the
 * daily run, and for the same reason (never defaulted; absent, it refuses rather
 * than improvising a database or serving an unguarded admin surface).
 * `tests/architecture.test.ts` allows exactly these two entry points and no
 * module besides.
 *
 * The store is opened and the secret read here, both injected into
 * `createCalendarServer`, which never reads the environment itself — so the server
 * is exercisable over a real socket against an ephemeral store with a known
 * secret, and this file is the only thing the test cannot.
 */

const requireConnectionString = (): string => {
  const value = process.env["DATABASE_URL"];
  if (!value) {
    throw new Error("DATABASE_URL is required — the store connection is injected, never defaulted.");
  }
  return value;
};

/**
 * The admin secret (ADR-0030), named here beside the connection string — the same
 * kind of server-side credential, injected never defaulted (ADR-0010's rule). The
 * server compares it per request; absent, this refuses to start rather than serve
 * an unguarded admin surface. It is the long random token that gets rotated, and
 * the Basic Auth username is fixed and ignored, so there is nothing else to read.
 */
const requireAdminPassword = (): string => {
  const value = process.env["ADMIN_PASSWORD"];
  if (!value) {
    throw new Error("ADMIN_PASSWORD is required — the admin secret is injected, never defaulted.");
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
  const server = createCalendarServer({
    store,
    siteDir: SITE_DIR,
    adminPassword: requireAdminPassword(),
  });
  server.listen(port, () => {
    console.log(`Serving the calendar on :${port}`);
  });
};

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
