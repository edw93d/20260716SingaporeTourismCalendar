import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { instantFromDate, type Instant } from "../domain/instant.js";
import { projectVenueEvent } from "../domain/project.js";
import type { PortCall, Scraped, SourceId, VenueEvent } from "../domain/types.js";
import { serializeCalendar } from "../feeds/ical.js";
import type { FetchDeps, HttpClient, ParseFailure, Source } from "../sources/types.js";
import { openStore } from "../store/store.js";

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
   * The rate-limited client the core injects into every adapter.
   *
   * Optional only because no adapter exists yet to use one; the default refuses
   * rather than improvises, so the first real adapter fails loudly at the wiring
   * instead of quietly acquiring an unpoliced route to the network.
   */
  http?: HttpClient;
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

const REFUSING_HTTP: HttpClient = {
  get: async (url) => {
    throw new Error(
      `No HTTP client is wired into this pipeline run, so ${url} was not fetched. Pass one via \`http\`.`,
    );
  },
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
  http = REFUSING_HTTP,
}: PipelineOptions): Promise<PipelineRun> => {
  const ranAt = instantFromDate(now());
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

    mkdirSync(feedsDir, { recursive: true });
    writeFileSync(
      join(feedsDir, "venue-events.ics"),
      serializeCalendar({
        name: "SG Venue Events",
        entries: store.readVenueEvents().map(projectVenueEvent),
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
  store: ReturnType<typeof openStore>,
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
