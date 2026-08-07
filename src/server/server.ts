import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import type { Instant } from "../domain/instant.js";
import type { PortCall, VenueEvent } from "../domain/types.js";
import { buildSitePayload, type SitePayload } from "../site/payload.js";
import type { Store } from "../store/store.js";

/**
 * The public read surface (#154). One always-on server does two jobs: it serves
 * the committed static page out of `site/`, and it answers `GET /calendar.json`
 * with the data payload **built live from the store** on every request — so a
 * moderator's hide takes effect on the next page load rather than the next run
 * (ADR-0025 §4, ADR-0026). There is no publish step and no committed
 * `calendar.json`: the page reads the same projection (`buildSitePayload`) the
 * feeds do, so it cannot drift from what the store holds.
 *
 * **This is the read surface only.** The route is open — no auth — because the
 * calendar is public; the admin write routes (ADR-0030) are a later ticket and
 * live nowhere here. The store is injected, not opened, so the whole thing is
 * exercisable over a real socket against an ephemeral store without the entry
 * point's environment read (`tests/server.test.ts`).
 */

export type CalendarServerDeps = {
  /** The store the payload is built from, live, on every request. Injected. */
  store: Store;
  /**
   * The static site root — the committed `site/` directory holding `index.html`
   * and `calendar.js`. A path, not the files: the entry point points this at the
   * repo's `site/`, a test at a fixture directory.
   */
  siteDir: string;
};

/** The content types the static tree actually holds. Unlisted extensions 404. */
const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
};

/**
 * The payload as served. Ordinarily `buildSitePayload` with the stored run
 * instant — but a store that has never recorded a run has not *published*, so
 * `generatedAt` is dropped entirely rather than sent as some default. That
 * missing field is the freshness alarm's "not yet published" branch, and it is a
 * different thing from a real-but-stale calendar (ADR-0013, `src/site/payload.ts`).
 *
 * The instant handed to `buildSitePayload` in that case is destructured straight
 * back out and never serialized — the projection only ever *places* it — so
 * `buildSitePayload` stays the single source of the page's shape and the omission
 * is the only difference on the wire.
 */
const livePayload = async (
  store: Store,
): Promise<SitePayload | Omit<SitePayload, "generatedAt">> => {
  const venueEvents: VenueEvent[] = await store.readVenueEvents();
  const portCalls: PortCall[] = await store.readPortCalls();
  const lastRun: Instant | null = await store.lastRun();

  if (lastRun !== null) return buildSitePayload(venueEvents, portCalls, lastRun);

  const { generatedAt: _unpublished, ...rest } = buildSitePayload(
    venueEvents,
    portCalls,
    UNPUBLISHED,
  );
  return rest;
};

/**
 * A throwaway instant, handed to `buildSitePayload` only on the never-run path
 * and stripped in the same expression, so it is never read or sent. Named so its
 * one job — satisfy the required argument on a branch that discards it — is legible.
 */
const UNPUBLISHED = "1970-01-01T00:00:00Z" as Instant;

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  const text = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(text),
  });
  res.end(text);
};

const sendText = (res: ServerResponse, status: number, message: string): void => {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(message);
};

/**
 * Serves one file out of `siteDir`, or 404s. The path is percent-decoded (so a
 * real filename with a space resolves, and so an *encoded* `..` cannot smuggle a
 * traversal past `URL`'s own normalization), then resolved and **checked back
 * against the root**: a request that escaped the tree with `../` resolves to
 * somewhere outside it, and the containment test rejects it before a byte is
 * read. `/` maps to `index.html`; a leading slash is stripped so the request
 * path can never be read as absolute.
 */
const serveStatic = async (
  res: ServerResponse,
  siteDir: string,
  pathname: string,
): Promise<void> => {
  let relative: string;
  try {
    relative = decodeURIComponent(pathname === "/" ? "index.html" : pathname.replace(/^\/+/, ""));
  } catch {
    // A malformed `%` sequence is a bad request, not a path to resolve.
    sendText(res, 400, "bad request");
    return;
  }

  const root = resolve(siteDir);
  const target = resolve(root, relative);

  if (target !== root && !target.startsWith(root + sep)) {
    sendText(res, 403, "forbidden");
    return;
  }

  const contentType = CONTENT_TYPES[extname(target)];
  if (contentType === undefined) {
    sendText(res, 404, "not found");
    return;
  }

  let body: Buffer;
  try {
    body = await readFile(target);
  } catch {
    sendText(res, 404, "not found");
    return;
  }

  res.writeHead(200, { "content-type": contentType, "content-length": body.byteLength });
  res.end(body);
};

const handle = async (
  req: IncomingMessage,
  res: ServerResponse,
  { store, siteDir }: CalendarServerDeps,
): Promise<void> => {
  // GET only: the read surface reads. Writes (ADR-0030) live behind auth on a
  // later ticket, and rejecting other methods here keeps this file honestly
  // read-only rather than silently ignoring a body it was never meant to accept.
  if (req.method !== "GET") {
    sendText(res, 405, "method not allowed");
    return;
  }

  const { pathname } = new URL(req.url ?? "/", "http://localhost");

  if (pathname === "/calendar.json") {
    sendJson(res, 200, await livePayload(store));
    return;
  }

  await serveStatic(res, siteDir, pathname);
};

/**
 * Builds the server without listening — the caller (the entry point, or a test)
 * owns the `listen`, so a test can bind port 0 and read the assigned port back.
 * A handler that throws is answered with a 500 rather than crashing the process:
 * one malformed request must not take the always-on server down.
 */
export const createCalendarServer = (deps: CalendarServerDeps): Server =>
  createServer((req, res) => {
    handle(req, res, deps).catch((error: unknown) => {
      if (!res.headersSent) sendText(res, 500, "internal error");
      else res.end();
      console.error("request failed:", error);
    });
  });
