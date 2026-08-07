import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { instant, type Instant } from "../src/domain/instant.js";
import type { PortCall, VenueEvent } from "../src/domain/types.js";
import { createCalendarServer } from "../src/server/server.js";
import type { SitePayload } from "../src/site/payload.js";
import type { Store } from "../src/store/store.js";

/**
 * **The server seam — the public read surface over a real socket** (#154). Every
 * test binds an `http.Server` on port 0 and `fetch`es it, so the routing, the
 * traversal guard and the content types are exercised as HTTP, not as function
 * calls. The store is a fake: `store.lastRun` and the projection are proven at
 * their own seams (`tests/store.test.ts`, `tests/payload.test.ts`), so what is
 * left to prove here is that the server reads them and answers correctly —
 * including the never-published branch, which a fake pins exactly.
 */

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const bniVision = (): VenueEvent => ({
  uid: "uid-ve-1@sg-tourism-calendar",
  sequence: 0,
  source: "suntec",
  sourceKey: "bni-vision1472026",
  name: "BNI Vision",
  start: instant("2026-07-17T04:00:00Z"),
  end: instant("2026-07-17T10:00:00Z"),
  venue: "Suntec Convention Centre",
  hall: "Level 4, Hall 404",
  hidden: false,
  reviewed: false,
  firstSeenAt: instant("2026-07-01T02:00:00Z"),
  lastSeenAt: instant("2026-07-01T02:00:00Z"),
});

const odyssey = (): PortCall => ({
  uid: "uid-pc-1@sg-tourism-calendar",
  sequence: 0,
  source: "scc",
  sourceKey: "ODYSSEY|2026-07-18",
  vessel: "ODYSSEY / VILLA VIE RESIDENCES",
  terminal: "Singapore Cruise Centre",
  berth: "Pier 2",
  arrival: instant("2026-07-18T00:00:00Z"),
  departure: instant("2026-07-18T10:00:00Z"),
  firstSeenAt: instant("2026-07-01T02:00:00Z"),
  lastSeenAt: instant("2026-07-01T02:00:00Z"),
});

const notCalled = (): never => {
  throw new Error("the server must not reach this store method");
};

/** The injected admin secret — a long random token, as ADR-0030 §3 requires. */
const ADMIN_SECRET = "T0k3n-long-random-do-not-guess-9f2a1c";

/** A Basic Auth header. The username is fixed and ignored (ADR-0030 §3). */
const basic = (password: string, user = "admin"): string =>
  `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

/**
 * A store the server reads and nothing more. It calls exactly three methods —
 * the two reads and `lastRun` — so the rest throw if the server ever grows a
 * write path it should not have.
 */
const fakeStore = (over: Partial<Store>): Store => ({
  readVenueEvents: async () => [],
  readPortCalls: async () => [],
  lastRun: async () => null,
  upsertVenueEvent: notCalled,
  upsertPortCall: notCalled,
  setModerationFlag: notCalled,
  recordRun: notCalled,
  transact: notCalled,
  close: async () => {},
  ...over,
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let siteDir: string;
let stop: (() => Promise<void>) | null;

beforeEach(() => {
  siteDir = mkdtempSync(join(tmpdir(), "sg-site-"));
  writeFileSync(join(siteDir, "index.html"), "<!doctype html><title>calendar</title>");
  writeFileSync(join(siteDir, "calendar.js"), "export const mountCalendar = () => {};");
  writeFileSync(join(siteDir, "secret.txt"), "must never be served");
  stop = null;
});

afterEach(async () => {
  if (stop) await stop();
  rmSync(siteDir, { recursive: true, force: true });
});

/** Starts the server on an ephemeral port and returns its base URL. */
const serve = async (store: Store): Promise<string> => {
  const server = createCalendarServer({ store, siteDir, adminPassword: ADMIN_SECRET });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  stop = () => new Promise<void>((closed) => server.close(() => closed()));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
};

// ---------------------------------------------------------------------------

describe("GET /calendar.json", () => {
  it("builds the payload live from the store with the stored run instant", async () => {
    const generatedAt: Instant = instant("2026-08-06T02:00:00Z");
    const base = await serve(
      fakeStore({
        readVenueEvents: async () => [bniVision()],
        readPortCalls: async () => [odyssey()],
        lastRun: async () => generatedAt,
      }),
    );

    const response = await fetch(`${base}/calendar.json`);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("application/json");

    const payload = (await response.json()) as SitePayload;
    expect(payload.generatedAt).toBe(generatedAt);
    // Reused projection, not a re-implementation: the venue event's summary is
    // its name and its port call's summary is composed (src/site/payload.ts).
    expect(payload.venueEvents).toMatchObject([{ summary: "BNI Vision", source: "suntec" }]);
    expect(payload.portCalls).toMatchObject([
      { summary: "Cruise: ODYSSEY / VILLA VIE RESIDENCES at Singapore Cruise Centre" },
    ]);
  });

  it("omits generatedAt entirely before any run is recorded", async () => {
    // The never-published branch (ADR-0013): a missing field is the freshness
    // alarm's "not yet published" signal, which is not the same as a stale date.
    const base = await serve(
      fakeStore({ readVenueEvents: async () => [bniVision()], lastRun: async () => null }),
    );

    const response = await fetch(`${base}/calendar.json`);
    const payload = (await response.json()) as SitePayload;

    expect(payload).not.toHaveProperty("generatedAt");
    // The rest of the payload is still whole — the page still renders, unpublished.
    expect(payload.venueEvents).toHaveLength(1);
    expect(payload.portCalls).toEqual([]);
    expect(payload).toHaveProperty("sources");
  });

  it("is open — no credentials are required to read it", async () => {
    const base = await serve(fakeStore({ lastRun: async () => instant("2026-08-06T02:00:00Z") }));
    const response = await fetch(`${base}/calendar.json`);
    expect(response.status).toBe(200);
  });

  it("filters hidden VenueEvents out before projection, leaving the payload's shape intact", async () => {
    // Hide-before-projection (ADR-0024 §8, #156): a hidden record is dropped on
    // the *public* read, so it disappears from the calendar on the very next live
    // read — reversibly, since the store keeps the row. The payload's shape does
    // not change: it is still `venueEvents`/`portCalls`, just one shorter.
    const base = await serve(
      fakeStore({
        readVenueEvents: async () => [
          bniVision(),
          { ...bniVision(), uid: "uid-hidden", name: "Cleaned away", hidden: true },
        ],
        readPortCalls: async () => [odyssey()],
        lastRun: async () => instant("2026-08-06T02:00:00Z"),
      }),
    );

    const payload = (await (await fetch(`${base}/calendar.json`)).json()) as SitePayload;

    expect(payload.venueEvents).toMatchObject([{ summary: "BNI Vision" }]);
    expect(JSON.stringify(payload)).not.toContain("Cleaned away");
    // The port call is untouched — hiding is a VenueEvent-only property (ADR-0024 §2).
    expect(payload.portCalls).toHaveLength(1);
  });
});

describe("POST /admin/flag — the toggle write route (#156, ADR-0024)", () => {
  /** A store that records every flag write, so the route's exact call is asserted. */
  type Toggle = { uid: string; flag: "hidden" | "reviewed"; value: boolean };
  const recordingStore = (matched: boolean) => {
    const calls: Toggle[] = [];
    const store = fakeStore({
      setModerationFlag: async (uid, flag, value) => {
        calls.push({ uid, flag, value });
        return matched;
      },
    });
    return { store, calls };
  };

  const post = (base: string, body: unknown, auth = basic(ADMIN_SECRET)): Promise<Response> =>
    fetch(`${base}/admin/flag`, {
      method: "POST",
      headers: { authorization: auth, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("401s without credentials — the write path is behind the one boundary", async () => {
    // The guard sits one level up (ADR-0030 §5), so it covers this write route
    // before the store is ever reached — the recorder throws if it is.
    const { store } = recordingStore(true);
    const base = await serve(store);
    const response = await fetch(`${base}/admin/flag`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uid: "u", flag: "hidden", value: true }),
    });
    expect(response.status).toBe(401);
  });

  it("flips hidden and echoes the write back", async () => {
    const { store, calls } = recordingStore(true);
    const base = await serve(store);

    const response = await post(base, { uid: "uid-ve-1", flag: "hidden", value: true });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ uid: "uid-ve-1", flag: "hidden", value: true });
    expect(calls).toEqual([{ uid: "uid-ve-1", flag: "hidden", value: true }]);
  });

  it("flips reviewed independently — the store is asked for exactly that flag", async () => {
    // Independence (ADR-0024 §2): the route names only the flag it was told to,
    // so marking reviewed cannot touch hidden and vice versa.
    const { store, calls } = recordingStore(true);
    const base = await serve(store);

    await post(base, { uid: "uid-ve-1", flag: "reviewed", value: true });

    expect(calls).toEqual([{ uid: "uid-ve-1", flag: "reviewed", value: true }]);
  });

  it("reverts on the opposite value — the write is genuinely reversible", async () => {
    // Undo is the same route with the flipped value (ADR-0024 §7). Two calls, the
    // second the exact inverse of the first, and the store keeps the row between.
    const { store, calls } = recordingStore(true);
    const base = await serve(store);

    await post(base, { uid: "u", flag: "hidden", value: true });
    await post(base, { uid: "u", flag: "hidden", value: false });

    expect(calls).toEqual([
      { uid: "u", flag: "hidden", value: true },
      { uid: "u", flag: "hidden", value: false },
    ]);
  });

  it("404s an unknown uid rather than reporting a phantom success", async () => {
    const { store } = recordingStore(false);
    const base = await serve(store);
    const response = await post(base, { uid: "nope", flag: "hidden", value: true });
    expect(response.status).toBe(404);
  });

  it("400s a body naming a column that is not a moderation flag", async () => {
    // The store is never reached — an unknown flag is rejected at the route, so no
    // request can ask the SQL to write an arbitrary column.
    const base = await serve(fakeStore({ setModerationFlag: notCalled }));
    const response = await post(base, { uid: "u", flag: "sequence", value: true });
    expect(response.status).toBe(400);
  });

  it("400s a non-boolean value and a missing uid", async () => {
    const base = await serve(fakeStore({ setModerationFlag: notCalled }));
    expect((await post(base, { uid: "u", flag: "hidden", value: "yes" })).status).toBe(400);
    expect((await post(base, { flag: "hidden", value: true })).status).toBe(400);
  });

  it("400s a malformed JSON body", async () => {
    const base = await serve(fakeStore({ setModerationFlag: notCalled }));
    const response = await fetch(`${base}/admin/flag`, {
      method: "POST",
      headers: { authorization: basic(ADMIN_SECRET), "content-type": "application/json" },
      body: "{ not json",
    });
    expect(response.status).toBe(400);
  });
});

describe("the static site", () => {
  it("serves index.html at the root", async () => {
    const base = await serve(fakeStore({}));
    const response = await fetch(`${base}/`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("<title>calendar</title>");
  });

  it("serves calendar.js as JavaScript, so the module import resolves", async () => {
    const base = await serve(fakeStore({}));
    const response = await fetch(`${base}/calendar.js`);

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("javascript");
    expect(await response.text()).toContain("mountCalendar");
  });

  it("404s an unknown path", async () => {
    const base = await serve(fakeStore({}));
    expect((await fetch(`${base}/nope.html`)).status).toBe(404);
  });
});

describe("safety", () => {
  it("refuses a path that escapes the site root", async () => {
    // `URL` collapses a literal `../`, so the escape is smuggled in *encoded*
    // (`%2e%2e%2f`); the server decodes it, resolves outside `siteDir`, and the
    // containment guard rejects it before the neighbouring file is read.
    const base = await serve(fakeStore({}));
    const response = await fetch(`${base}/%2e%2e%2fsecret.txt`);

    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("must never be served");
  });

  it("serves a filename verbatim once the escape is stripped — the guard is not over-broad", async () => {
    // Guards the guard: a decoded path that stays inside the root still serves,
    // so the containment check is rejecting escapes, not every encoded request.
    const base = await serve(fakeStore({}));
    const response = await fetch(`${base}/%63alendar.js`);
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("mountCalendar");
  });

  it("rejects a non-GET request — the read surface does not write", async () => {
    const base = await serve(fakeStore({}));
    const response = await fetch(`${base}/calendar.json`, { method: "POST" });
    expect(response.status).toBe(405);
  });
});

describe("the admin surface behind Basic Auth (ADR-0030)", () => {
  it("401s a request with no credentials, and asks for Basic Auth", async () => {
    // The boundary: a stranger who loads the admin page is refused before any
    // row is read. The `WWW-Authenticate` header is what makes the browser prompt.
    const base = await serve(fakeStore({ readVenueEvents: notCalled }));
    const response = await fetch(`${base}/admin`);

    expect(response.status).toBe(401);
    expect(response.headers.get("www-authenticate")).toMatch(/^Basic/);
  });

  it("401s a wrong secret", async () => {
    const base = await serve(fakeStore({ readVenueEvents: notCalled }));
    const response = await fetch(`${base}/admin`, {
      headers: { authorization: basic("wrong-secret") },
    });
    expect(response.status).toBe(401);
  });

  it("lets the right secret through, and ignores the username", async () => {
    // Only the password is the secret; the username is fixed and ignored — so a
    // different username with the right password still reaches the surface.
    const base = await serve(fakeStore({ readVenueEvents: async () => [bniVision()] }));
    const response = await fetch(`${base}/admin`, {
      headers: { authorization: basic(ADMIN_SECRET, "anyone") },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/html");
    expect(await response.text()).toContain("BNI Vision");
  });

  it("renders every VenueEvent, including hidden and unreviewed rows", async () => {
    // The admin read shows what the public projection filters — the difference
    // between public and operator is the auth guard, not the query (ADR-0030 §5).
    const base = await serve(
      fakeStore({
        readVenueEvents: async () => [
          bniVision(),
          { ...bniVision(), uid: "uid-hidden", name: "Bad listing", hidden: true, reviewed: false },
        ],
      }),
    );
    const response = await fetch(`${base}/admin`, {
      headers: { authorization: basic(ADMIN_SECRET) },
    });
    const html = await response.text();

    expect(html).toContain("Bad listing");
    expect(html).toContain("Hidden");
    expect(html).toContain("Unreviewed");
  });

  it("guards every path under /admin, one level up — before routing or method", async () => {
    // The boundary wraps the whole admin subtree so every future write route is
    // covered by the same middleware, not a second line to keep in sync. A path
    // that does not exist yet still 401s without the secret, rather than 404ing.
    const base = await serve(fakeStore({ readVenueEvents: notCalled }));

    expect((await fetch(`${base}/admin/anything`)).status).toBe(401);
    expect(
      (await fetch(`${base}/admin/write`, { method: "POST" })).status,
    ).toBe(401);
  });

  it("leaves the public calendar read open even though /admin is guarded", async () => {
    // One boundary moves from public to operator; the calendar read is not behind it.
    const base = await serve(fakeStore({ lastRun: async () => instant("2026-08-06T02:00:00Z") }));

    expect((await fetch(`${base}/calendar.json`)).status).toBe(200);
    expect((await fetch(`${base}/`)).status).toBe(200);
  });
});
