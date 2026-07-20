import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { instantFromDate, type Instant } from "../domain/instant.js";
import { projectPortCall, projectVenueEvent } from "../domain/project.js";
import type { PortCall, Scraped, SourceId, VenueEvent } from "../domain/types.js";
import { serializeCalendar } from "../feeds/ical.js";
import type { FetchDeps, HttpClient, ParseFailure, Source } from "../sources/types.js";
import { openStore, type Store } from "../store/store.js";

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

export type PipelineRun = {
  ranAt: Instant;
  outcomes: SourceOutcome[];
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
  now,
  http,
}: PipelineOptions): Promise<PipelineRun> => {
  const ranAt = instantFromDate(now());

  // No `browser` key: it is optional on `FetchDeps`, and leaving it off is what
  // scopes headless to the one adapter that will declare a need for it. Suntec
  // cannot acquire one, enforced by the type rather than by a note in a doc.
  const deps: FetchDeps = { http, now };

  const store = openStore(db);

  try {
    const outcomes: SourceOutcome[] = [];

    for (const source of sources) {
      // Sequential, not concurrent: politeness is the posture the facts-only
      // legal position rests on, and one source failing must not take the run
      // — and with it every other source's `lastSeenAt` — down with it.
      const outcome = await readSource(source, deps, ranAt, store);
      outcomes.push(outcome);
    }

    // Two feeds, split by **type** — never a single firehose, never split by
    // source, and there is no `all` (ADR-0008). The audience thinks in demand
    // shapes, `source` already rides inside every entry, and the unfiltered
    // duplicate-heavy stream is not a subscription anyone should hold. The
    // everything-view is the web calendar. Consequently the feed set grows with
    // types, not sources: a fourth source folds into one of these two.
    mkdirSync(feedsDir, { recursive: true });
    writeFileSync(
      join(feedsDir, "venue-events.ics"),
      serializeCalendar({
        name: "SG Venue Events",
        entries: store.readVenueEvents().map(projectVenueEvent),
        dtstamp: ranAt,
      }),
    );
    writeFileSync(
      join(feedsDir, "port-calls.ics"),
      serializeCalendar({
        name: "SG Cruise Arrivals",
        entries: store.readPortCalls().map(projectPortCall),
        dtstamp: ranAt,
      }),
    );

    return { ranAt, outcomes };
  } finally {
    store.close();
  }
};

const readSource = async (
  source: Source<VenueEvent> | Source<PortCall>,
  deps: FetchDeps,
  seenAt: Instant,
  store: Store,
): Promise<SourceOutcome> => {
  let result;
  try {
    result = source.parse(await source.fetch(deps), deps.now());
  } catch (error) {
    return {
      source: source.key,
      ok: false,
      reason: `fetch or parse threw: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  if (!result.ok) {
    // **Zero rows is ambiguous, so a not-ok parse is not an empty source.** The
    // Singapore Cruise Centre challenge page returns HTTP 200 and is
    // byte-plausible as a quiet week. Writing nothing here is deliberate:
    // nothing is upserted, so no `lastSeenAt` advances and every record this
    // source owns is left exactly as the last real reading left it.
    return { source: source.key, ok: false, reason: result.reason };
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

  return {
    source: source.key,
    ok: true,
    records: result.records.length,
    failures: result.failures,
  };
};
