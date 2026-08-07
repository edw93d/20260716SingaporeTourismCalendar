import { timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";
import type { Instant } from "../domain/instant.js";
import type { ModerationFlag, PortCall, VenueEvent } from "../domain/types.js";
import { buildSitePayload, type SitePayload } from "../site/payload.js";
import { manifests } from "../sources/registry.js";
import type { Store } from "../store/store.js";
import { renderAdminPage } from "./admin.js";

/**
 * The public read surface (#154). One always-on server does two jobs: it serves
 * the committed static page out of `site/`, and it answers `GET /calendar.json`
 * with the data payload **built live from the store** on every request — so a
 * moderator's hide takes effect on the next page load rather than the next run
 * (ADR-0025 §4, ADR-0026). There is no publish step and no committed
 * `calendar.json`: the page reads the same projection (`buildSitePayload`) the
 * feeds do, so it cannot drift from what the store holds.
 *
 * **The public calendar read is open** — no auth — because the calendar is
 * public (ADR-0026 §2). Everything under `/admin` is the operator surface and
 * sits behind one HTTP Basic Auth boundary against a single shared secret
 * (ADR-0030, #155): for now that surface is the read-only moderator spreadsheet,
 * with the write routes arriving under the same guard on later tickets. The store
 * and the admin secret are both injected, not opened/read here, so the whole
 * thing is exercisable over a real socket against an ephemeral store without the
 * entry point's environment read (`tests/server.test.ts`).
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
  /**
   * The one shared secret guarding the admin surface (ADR-0030). A long random
   * token compared per request as HTTP Basic Auth — **injected, never defaulted**
   * (ADR-0010's rule, whose property ADR-0030 §3 spends): the entry point reads it
   * from the environment and hands it here, so this module never touches
   * `process.env` and a test can drive the boundary with a known secret.
   */
  adminPassword: string;
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
  // Hide-before-projection (ADR-0024 §8, #156). Hidden records are dropped *here*,
  // before `buildSitePayload`, so the projection, `CalendarEntry` and the served
  // payload never receive one and cannot forget to check. This is the public read
  // path only: the admin surface reads `store.readVenueEvents()` directly, hidden
  // rows and all (ADR-0030 §5). A hide takes effect on the very next live read,
  // and unhiding restores the same entry (the store keeps the row, ADR-0024 §7).
  const venueEvents: VenueEvent[] = (await store.readVenueEvents()).filter(
    (record) => !record.hidden,
  );
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

/**
 * Everything under `/admin` is the operator surface (ADR-0030 §5) — the page,
 * the admin read, and every future write route. The boundary is this one test,
 * one level up, so a single Basic Auth guard covers the whole subtree rather than
 * each route guarding itself. The public calendar (`/`, the static tree,
 * `/calendar.json`) is not under it and stays open (ADR-0026 §2).
 */
const isAdminPath = (pathname: string): boolean =>
  pathname === "/admin" || pathname.startsWith("/admin/");

/**
 * The password from a Basic Auth header, or `null` if the header is absent or
 * malformed. **The username is parsed off and discarded** — only the password is
 * the secret (ADR-0030 §3), so any username with the right password passes.
 */
const passwordFromHeader = (header: string | undefined): string | null => {
  if (header === undefined) return null;
  const match = /^Basic (.+)$/.exec(header);
  if (match === null) return null;
  const decoded = Buffer.from(match[1]!, "base64").toString("utf8");
  const separator = decoded.indexOf(":");
  if (separator === -1) return null;
  return decoded.slice(separator + 1);
};

/**
 * A length-guarded constant-time comparison. `timingSafeEqual` throws on a length
 * mismatch, so the lengths are checked first — and the check itself leaks only the
 * length, never the content, which a long random token does not depend on hiding.
 * Brute force is out of scope only because the secret is a long random token
 * (ADR-0030 §3); this keeps the comparison itself from being the leak.
 */
const secretMatches = (supplied: string, expected: string): boolean => {
  const a = Buffer.from(supplied, "utf8");
  const b = Buffer.from(expected, "utf8");
  return a.length === b.length && timingSafeEqual(a, b);
};

/** Answers a request that failed the boundary — 401, and the browser's prompt. */
const sendUnauthorized = (res: ServerResponse): void => {
  res.writeHead(401, {
    "www-authenticate": 'Basic realm="admin", charset="UTF-8"',
    "content-type": "text/plain; charset=utf-8",
  });
  res.end("unauthorized");
};

/**
 * Reads a request body as JSON, with a small hard cap — a toggle is a handful of
 * bytes, so anything larger is malformed or hostile and is refused before it is
 * buffered whole. Rejects on invalid JSON too; the caller answers either as a 400.
 */
const MAX_BODY_BYTES = 4 * 1024;

const readJsonBody = (req: IncomingMessage): Promise<unknown> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (chunk: Buffer) => {
      size += chunk.byteLength;
      if (size > MAX_BODY_BYTES) {
        reject(new Error("request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on("end", () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch (error) {
        reject(error instanceof Error ? error : new Error("invalid JSON"));
      }
    });
    req.on("error", reject);
  });

/** The validated shape of a toggle request — an unknown flag or a non-boolean is rejected. */
type FlagRequest = { uid: string; flag: ModerationFlag; value: boolean };

const FLAGS: readonly ModerationFlag[] = ["hidden", "reviewed"];

/**
 * Parses an untrusted JSON body into a `FlagRequest`, or `null` if it is not one.
 * Every field is checked — `flag` against the closed set, `value` as a real
 * boolean — so nothing past this point trusts the request's shape, and the store
 * is never asked to write a column the operator did not name.
 */
const parseFlagRequest = (body: unknown): FlagRequest | null => {
  if (typeof body !== "object" || body === null) return null;
  const { uid, flag, value } = body as Record<string, unknown>;
  if (typeof uid !== "string" || uid === "") return null;
  if (typeof flag !== "string" || !FLAGS.includes(flag as ModerationFlag)) return null;
  if (typeof value !== "boolean") return null;
  return { uid, flag: flag as ModerationFlag, value };
};

/**
 * The admin surface, reached only past the boundary (ADR-0030 §5). Two routes:
 * `GET /admin`, the moderator spreadsheet built live from the store — every
 * `VenueEvent` including the hidden and the unreviewed — and `POST /admin/flag`,
 * the one write path, which flips a single moderation flag on one record. The
 * write names only the flag the operator toggled, so the two flags stay
 * independent and a scrape can touch neither (ADR-0024 §2, `store.setModerationFlag`).
 * Anything else 404s, but behind auth, having already passed the boundary above.
 */
const handleAdmin = async (
  req: IncomingMessage,
  res: ServerResponse,
  store: Store,
  pathname: string,
): Promise<void> => {
  if (req.method === "GET" && pathname === "/admin") {
    const venueEvents = await store.readVenueEvents();
    const html = renderAdminPage(venueEvents, (source) => manifests[source]?.description);
    res.writeHead(200, {
      "content-type": "text/html; charset=utf-8",
      "content-length": Buffer.byteLength(html),
    });
    res.end(html);
    return;
  }

  if (req.method === "POST" && pathname === "/admin/flag") {
    let body: unknown;
    try {
      body = await readJsonBody(req);
    } catch {
      sendText(res, 400, "bad request");
      return;
    }
    const request = parseFlagRequest(body);
    if (request === null) {
      sendText(res, 400, "bad request");
      return;
    }
    const matched = await store.setModerationFlag(request.uid, request.flag, request.value);
    if (!matched) {
      sendText(res, 404, "not found");
      return;
    }
    // Echo the flip back so the client confirms what it applied — the pill and the
    // Undo it raises revert this exact write (ADR-0024 §7).
    sendJson(res, 200, { uid: request.uid, flag: request.flag, value: request.value });
    return;
  }

  sendText(res, 404, "not found");
};

const handle = async (
  req: IncomingMessage,
  res: ServerResponse,
  { store, siteDir, adminPassword }: CalendarServerDeps,
): Promise<void> => {
  const { pathname } = new URL(req.url ?? "/", "http://localhost");

  // The one boundary (ADR-0030 §5), checked before routing or method so it wraps
  // the whole admin subtree — including routes that do not exist yet.
  if (isAdminPath(pathname)) {
    const supplied = passwordFromHeader(req.headers.authorization);
    if (supplied === null || !secretMatches(supplied, adminPassword)) {
      sendUnauthorized(res);
      return;
    }
    await handleAdmin(req, res, store, pathname);
    return;
  }

  // GET only: the public read surface reads. Rejecting other methods here keeps
  // this file honestly read-only rather than silently ignoring a body it was
  // never meant to accept.
  if (req.method !== "GET") {
    sendText(res, 405, "method not allowed");
    return;
  }

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
