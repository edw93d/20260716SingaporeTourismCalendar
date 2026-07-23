import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { instantFromDate, type Instant } from "../domain/instant.js";
import { projectPortCall, projectVenueEvent } from "../domain/project.js";
import type { DomainRecord, PortCall, Scraped, SourceId, VenueEvent } from "../domain/types.js";
import { serializeCalendar } from "../feeds/ical.js";
import { buildSitePayload } from "../site/payload.js";
import type { BrowserSession, FetchDeps, HttpClient, ParseFailure, Source } from "../sources/types.js";
import { openStore, type Store } from "../store/store.js";
import { assess, cohortDelta, type BreakageSignal } from "./breakage.js";

/**
 * One pipeline run: every source is read, what it observed is folded into the
 * store's memory, and the feeds are re-emitted from the store — never from the
 * scrape.
 *
 * **Re-emitting from the store, not the scrape, is what makes retention real.**
 * A record absent from today's scrape still appears in today's feed, because the
 * feed is a view over everything ever seen. Absence stops `lastSeenAt` advancing
 * and does nothing else.
 */

export type PipelineOptions = {
  sources: (Source<VenueEvent> | Source<PortCall>)[];
  /** Path to the SQLite file. Created, with its directory, if absent. */
  db: string;
  /** Where the `.ics` files land. */
  feedsDir: string;
  /**
   * Where the web calendar's data payload lands — the everything-view the static
   * page is built from (#38). A path rather than a directory because it is one
   * file, and it sits above `feedsDir` in the published root (ADR-0011), not
   * inside it.
   */
  payloadPath: string;
  now: () => Date;
  /**
   * The rate-limited client every adapter reads through.
   *
   * **Required, and deliberately not defaulted.** A default of
   * `createHttpClient()` would invert what the `NO_HTTP_CLIENT_YET` placeholder
   * was for: that placeholder existed so unfinished wiring would refuse rather
   * than improvise. Defaulting means a caller who simply forgets to inject —
   * a new test as easily as a new entry point — silently reaches the live
   * internet, which is the one failure mode a scrape with a politeness posture
   * cannot afford to have happen quietly.
   *
   * Reaching the network is therefore something a caller has to say out loud.
   * Tests pass a stub and never leave the machine; the entry point passes
   * `createHttpClient()`.
   */
  http: HttpClient;
  /**
   * The headless browser session, injected **only** because MBCCS declares a need
   * for one. Optional and undefaulted for the same reason `http` is required but
   * `browser` is not: an adapter that does not ask for a browser cannot acquire
   * one, so headless stays scoped to the single source that needs it (ADR-0005).
   *
   * The core owns its lifecycle — the entry point launches it and closes it in a
   * `finally`; the pipeline only forwards it. A run whose sources include none
   * that need a browser (every test in `pipeline.test.ts`) passes nothing, and
   * MBCCS's `fetch` throws loudly if it is ever reached without one.
   */
  browser?: BrowserSession;
};

/**
 * What each source did this run. Returned rather than logged because three of
 * the four breakage signals are visible only here, at the point the source was
 * read — and a run that swallowed them would have to re-derive them later from
 * nothing.
 */
export type SourceOutcome =
  | { source: SourceId; ok: true; records: number; failures: ParseFailure[] }
  | { source: SourceId; ok: false; reason: string };

/**
 * The breakage signals raised against one source this run — the alerting layer's
 * whole input (ADR-0007, #41). Empty means healthy. Returned per source rather
 * than logged because a break is stateful: the caller reconciles these against
 * the one open GitHub issue per source, opening it when signals appear and
 * closing it when they clear.
 */
export type SourceBreakage = {
  source: SourceId;
  signals: BreakageSignal[];
};

export type PipelineRun = {
  ranAt: Instant;
  outcomes: SourceOutcome[];
  breakage: SourceBreakage[];
};

/**
 * The two record types are told apart structurally, on the one field only a
 * `PortCall` has. There is no discriminator on the wire and there should not be:
 * `Raw` is adapter-owned and the domain types are honest, separate shapes.
 */
const isPortCall = (
  record: Scraped<VenueEvent> | Scraped<PortCall>,
): record is Scraped<PortCall> => "vessel" in record;

export const runPipeline = async ({
  sources,
  db,
  feedsDir,
  payloadPath,
  now,
  http,
  browser,
}: PipelineOptions): Promise<PipelineRun> => {
  const ranAt = instantFromDate(now());

  // `browser` is forwarded only when the caller supplied one. Leaving it
  // `undefined` is what scopes headless to the one adapter that declares a need:
  // Suntec and SCC destructure `http` and never `browser`, so they cannot acquire
  // one, enforced by the type rather than by a note in a doc.
  const deps: FetchDeps = { http, now, ...(browser ? { browser } : {}) };

  const store = openStore(db);

  try {
    // Snapshot the store **before any upsert**, so breakage detection compares
    // against the previous run's memory rather than this run's own writes. Taken
    // once up front because no source's upsert has landed yet — a source only
    // ever owns rows in one table, so filtering both by `source` recovers exactly
    // its previous cohort (ADR-0007 §2).
    const previousVenueEvents = store.readVenueEvents();
    const previousPortCalls = store.readPortCalls();
    const previousFor = (key: SourceId): DomainRecord[] =>
      [...previousVenueEvents, ...previousPortCalls].filter((record) => record.source === key);

    const outcomes: SourceOutcome[] = [];
    const breakage: SourceBreakage[] = [];

    for (const source of sources) {
      // Sequential, not concurrent: politeness is the posture the facts-only
      // legal position rests on, and one source failing must not take the run
      // — and with it every other source's `lastSeenAt` — down with it.
      const { outcome, signals } = await readSource(
        source,
        deps,
        ranAt,
        store,
        previousFor(source.key),
      );
      outcomes.push(outcome);
      breakage.push({ source: source.key, signals });
    }

    // Two feeds, split by **type** — never a single firehose, never split by
    // source, and there is no `all` (ADR-0008). The audience thinks in demand
    // shapes, `source` already rides inside every entry, and the unfiltered
    // duplicate-heavy stream is not a subscription anyone should hold. The
    // everything-view is the web calendar. Consequently the feed set grows with
    // types, not sources: a fourth source folds into one of these two.
    const venueEvents = store.readVenueEvents();
    const portCalls = store.readPortCalls();

    mkdirSync(feedsDir, { recursive: true });
    writeFileSync(
      join(feedsDir, "venue-events.ics"),
      serializeCalendar({
        name: "SG Venue Events",
        entries: venueEvents.map(projectVenueEvent),
        dtstamp: ranAt,
      }),
    );
    writeFileSync(
      join(feedsDir, "port-calls.ics"),
      serializeCalendar({
        name: "SG Cruise Arrivals",
        entries: portCalls.map(projectPortCall),
        dtstamp: ranAt,
      }),
    );

    // The everything-view the web calendar is built from (#38, ADR-0009 §4):
    // both types, every source, duplicates unmerged, emitted from the store like
    // the feeds so retention is real — a record absent from today's scrape still
    // ships to the page. It also bakes the per-source last-confirmed instant (#40)
    // — a machine-readable proof-of-life the page turns into a growing "X ago"
    // client-side; that instant advances every healthy run, so the entries stay
    // byte-stable when nothing changed but the freshness line does not, by design.
    mkdirSync(dirname(payloadPath), { recursive: true });
    writeFileSync(
      payloadPath,
      `${JSON.stringify(buildSitePayload(venueEvents, portCalls, ranAt), null, 2)}\n`,
    );

    return { ranAt, outcomes, breakage };
  } finally {
    store.close();
  }
};

const readSource = async (
  source: Source<VenueEvent> | Source<PortCall>,
  deps: FetchDeps,
  seenAt: Instant,
  store: Store,
  previous: DomainRecord[],
): Promise<{ outcome: SourceOutcome; signals: BreakageSignal[] }> => {
  let result;
  try {
    result = source.parse(await source.fetch(deps), deps.now());
  } catch (error) {
    // A `fetch` that threw here is **post-retry** — the core-injected client has
    // already exhausted its backoff (ADR-0007 §5), so this is a break, not a
    // flaky moment. Drift detection is skipped: there are no records to compare.
    const outcome: SourceOutcome = {
      source: source.key,
      ok: false,
      reason: `fetch or parse threw: ${error instanceof Error ? error.message : String(error)}`,
    };
    return { outcome, signals: assess(outcome, null) };
  }

  if (!result.ok) {
    // **Zero rows is ambiguous, so a not-ok parse is not an empty source.** The
    // Singapore Cruise Centre challenge page returns HTTP 200 and is
    // byte-plausible as a quiet week. Writing nothing here is deliberate:
    // nothing is upserted, so no `lastSeenAt` advances and every record this
    // source owns is left exactly as the last real reading left it. Drift
    // detection is skipped too (ADR-0007 §4): an absent anchor reads as a 100%
    // drop, and firing a mass-cancellation alert on top of "the page isn't ours"
    // would be a second, misleading signal.
    const outcome: SourceOutcome = { source: source.key, ok: false, reason: result.reason };
    return { outcome, signals: assess(outcome, null) };
  }

  // Failed rows do not block the good ones — but they are reported, never
  // dropped. A silently dropped row stops appearing and becomes
  // indistinguishable from a genuine absence, which launders a scraper defect
  // into a domain observation.
  store.transact(() => {
    for (const record of result.records) {
      if (isPortCall(record)) store.upsertPortCall(record, seenAt);
      else store.upsertVenueEvent(record, seenAt);
    }
  });

  const outcome: SourceOutcome = {
    source: source.key,
    ok: true,
    records: result.records.length,
    failures: result.failures,
  };

  // The one signal a parser cannot raise: the net change in the future-dated
  // cohort against the store's memory of the previous run (ADR-0007 §2).
  const delta = cohortDelta(previous, result.records, deps.now());
  return { outcome, signals: assess(outcome, delta) };
};
