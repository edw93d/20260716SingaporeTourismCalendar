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
  const server = createCalendarServer({ store, siteDir });
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
