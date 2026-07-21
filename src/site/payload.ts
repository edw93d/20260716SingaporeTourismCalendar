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

export type SitePayload = {
  venueEvents: SiteEntry[];
  portCalls: SiteEntry[];
};

const toSiteEntry = (entry: CalendarEntry): SiteEntry => ({
  uid: entry.uid,
  summary: entry.summary,
  start: entry.start,
  end: entry.end,
  location: entry.location,
  source: entry.source,
});

export const buildSitePayload = (
  venueEvents: VenueEvent[],
  portCalls: PortCall[],
): SitePayload => ({
  venueEvents: venueEvents.map(projectVenueEvent).map(toSiteEntry),
  portCalls: portCalls.map(projectPortCall).map(toSiteEntry),
});
