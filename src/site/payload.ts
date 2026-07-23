import type { Instant } from "../domain/instant.js";
import { projectPortCall, projectVenueEvent } from "../domain/project.js";
import type { CalendarEntry, PortCall, SourceId, VenueEvent } from "../domain/types.js";

/**
 * The web calendar's data payload — what the static page is *built from*
 * (#38). It is the everything-view #11 made load-bearing when it killed the
 * firehose feed: the whole dataset, both types, every source, duplicates
 * unmerged, shipped once to the client which filters it for free (ADR-0009 §4).
 *
 * Like a future Excel export, this is **a serializer that reads the domain
 * types** — but unlike Excel it needs nothing `CalendarEntry` flattens away, so
 * it reuses the settled projection (`projectVenueEvent` / `projectPortCall`)
 * rather than widening it. The web calendar and the two feeds therefore render
 * the *same* projected `summary` and `location`, and cannot drift.
 *
 * **Split by type, exactly as the feeds are** (ADR-0008): the client's
 * All / VenueEvent / PortCall filter is that split made interactive, and putting
 * the type in the payload's shape rather than a per-entry discriminator keeps it
 * honest — the two record types are separate shapes, not one tagged union.
 */

/**
 * One entry as the page renders it. A deliberate **subset** of `CalendarEntry`:
 * the client shows the source as its own label (every entry is labelled by
 * source, #38) and infers the category from which array the entry sits in, so
 * neither the `description` prose the feeds need nor any other field rides
 * along. Nothing here is a magnitude, score, or count — none exists to carry
 * (ADR-0009 §5), and this shape is where such a field would first appear.
 */
export type SiteEntry = {
  uid: string;
  /** `name`, or `Cruise: {vessel} at {terminal}` — the reader-facing title. */
  summary: string;
  /** UTC instant; the client places it in Singapore time. */
  start: Instant;
  end: Instant;
  /** Venue (+ hall), or the terminal — never a berth. */
  location: string;
  source: SourceId;
};

/**
 * One source's freshness — the **only always-true proof the pipeline ran** (#40,
 * #17). `lastConfirmed` is the source's most recent confirmation, a
 * machine-readable ISO instant; the *page* computes the "X ago" text from it at
 * load, never the build (a baked relative string would freeze at "4 hours ago"
 * forever the moment the pipeline died — reassuring at exactly the wrong moment).
 *
 * **The unit is the source, never a record** (ADR-0004): it is the *max*
 * `lastSeenAt` across every record the source owns, so a source stays live in the
 * disclosure while individual records drop. This is no `status` field on a
 * record — absence is still never resolved into a verdict (ADR-0007 §7).
 */
export type SourceFreshness = {
  source: SourceId;
  lastConfirmed: Instant;
};

export type SitePayload = {
  /**
   * When this artifact was published — the run instant (#61, ADR-0013). The
   * freshness alarm reads this field and nothing else.
   *
   * **Deliberately not derived from any source.** `sources[].lastConfirmed`
   * below looks like it would serve, and does not: it freezes when a *scraper*
   * breaks, so an alarm reading it would fire on a calendar that published
   * perfectly on time. Freshness is a property of the published artifact and is
   * orthogonal to Source health in both directions (CONTEXT.md § Freshness);
   * this field is the only one in the payload that respects that, because it is
   * present and current on a run that confirmed no source at all.
   *
   * It also makes `calendar.json` differ on every run, as `DTSTAMP` already
   * makes the feeds differ (ADR-0011) — bounded churn, beside a store blob that
   * changes every run anyway.
   */
  generatedAt: Instant;
  venueEvents: SiteEntry[];
  portCalls: SiteEntry[];
  sources: SourceFreshness[];
};

const toSiteEntry = (entry: CalendarEntry): SiteEntry => ({
  uid: entry.uid,
  summary: entry.summary,
  start: entry.start,
  end: entry.end,
  location: entry.location,
  source: entry.source,
});

/**
 * The per-source last-confirmed instant, maxed across every record either type
 * carries. `Instant` sorts chronologically as plain text (see `instant.ts`), so
 * the newest is a string comparison — no parsing. Sorted by source id so the
 * committed payload's diff is a stable ordering, not insertion order.
 */
const freshnessOf = (
  venueEvents: VenueEvent[],
  portCalls: PortCall[],
): SourceFreshness[] => {
  const latest = new Map<SourceId, Instant>();
  for (const { source, lastSeenAt } of [...venueEvents, ...portCalls]) {
    const seen = latest.get(source);
    if (seen === undefined || lastSeenAt > seen) latest.set(source, lastSeenAt);
  }
  return [...latest.entries()]
    .map(([source, lastConfirmed]) => ({ source, lastConfirmed }))
    .sort((a, b) => (a.source < b.source ? -1 : a.source > b.source ? 1 : 0));
};

export const buildSitePayload = (
  venueEvents: VenueEvent[],
  portCalls: PortCall[],
  generatedAt: Instant,
): SitePayload => ({
  generatedAt,
  venueEvents: venueEvents.map(projectVenueEvent).map(toSiteEntry),
  portCalls: portCalls.map(projectPortCall).map(toSiteEntry),
  sources: freshnessOf(venueEvents, portCalls),
});
