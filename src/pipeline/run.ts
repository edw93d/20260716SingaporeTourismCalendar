import { instantFromDate, type Instant } from "../domain/instant.js";
import type { DomainRecord, PortCall, Scraped, SourceId, VenueEvent } from "../domain/types.js";
import type { BrowserSession, FetchDeps, HttpClient, ParseFailure, Source } from "../sources/types.js";
import { openStore, type Store } from "../store/store.js";
import { assess, cohortDelta, type BreakageSignal } from "./breakage.js";

/**
 * One pipeline run: every source is read, and what it observed is folded into the
 * store's memory. That is the whole of it.
 *
 * **v2's run is a pure store writer** (ADR-0025 §4). v1 re-emitted `.ics` feeds
 * and the web calendar's `calendar.json` from the store on every run; v2 builds
 * no feeds (they are v3) and serves the web calendar live from the store, so the
 * run publishes nothing. What it still does — and the reason retention is real —
 * is upsert: a record absent from today's scrape stays in the store untouched,
 * because absence only stops `lastSeenAt` advancing and does nothing else.
 */

export type PipelineOptions = {
  sources: (Source<VenueEvent> | Source<PortCall>)[];
  /**
   * The Postgres connection string (ADR-0025). **Required and never defaulted**
   * — the entry point reads it and passes it, exactly as it passes `http`. A
   * default would be a caller silently reaching a database it never named.
   */
  connectionString: string;
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
  connectionString,
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

  const store = await openStore(connectionString);

  try {
    // Snapshot the store **before any upsert**, so breakage detection compares
    // against the previous run's memory rather than this run's own writes. Taken
    // once up front because no source's upsert has landed yet — a source only
    // ever owns rows in one table, so filtering both by `source` recovers exactly
    // its previous cohort (ADR-0007 §2).
    const previousVenueEvents = await store.readVenueEvents();
    const previousPortCalls = await store.readPortCalls();
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

    return { ranAt, outcomes, breakage };
  } finally {
    await store.close();
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

  // One transaction per source, not one per run (ADR-0025 §5): a source that
  // breaks mid-write rolls back its own records and no others. Failed rows do
  // not block the good ones — but they are reported, never dropped. A silently
  // dropped row stops appearing and becomes indistinguishable from a genuine
  // absence, which launders a scraper defect into a domain observation.
  await store.transact(async (tx) => {
    for (const record of result.records) {
      if (isPortCall(record)) await tx.upsertPortCall(record, seenAt);
      else await tx.upsertVenueEvent(record, seenAt);
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
