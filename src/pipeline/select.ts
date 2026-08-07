import type { PortCall, SourceId, VenueEvent } from "../domain/types.js";
import type { Source, SourceManifest } from "../sources/types.js";

/**
 * Turning the operator's *"which source?"* input into the run that will happen
 * (ADR-0028 §3, §6, §8). This is the whole of the on-demand scheduling logic, and
 * it is a **pure function** on purpose: the founding complaint was that every
 * invocation read everything, and the fix is small enough to decide here and test
 * at the pipeline seam without launching a browser or touching the store.
 *
 * Three facts come out of one input:
 *
 * - **`sources`** — the subset the run reads. Empty input runs the whole registry
 *   (the nightly cadence, unchanged); a source id runs exactly that one, which is
 *   the same sequential loop over a one-element array.
 * - **`needsBrowser`** — whether *any selected source* declares it. The entry
 *   point launches Chromium only when this is true, so a by-hand run of a
 *   browser-less source boots none (ADR-0028 §6). The decision is manifest-driven
 *   and read before the run, never part of `fetch`/`parse`.
 * - **`full`** — whether this run read the whole registry. Only a full run
 *   advances the freshness marker (ADR-0028 §8): a single-source poke must leave
 *   `generatedAt` untouched, or it would mask a dead nightly run — the exact
 *   silent-staleness failure the watcher exists to catch.
 */
export type RunSelection = {
  sources: (Source<VenueEvent> | Source<PortCall>)[];
  needsBrowser: boolean;
  full: boolean;
};

/**
 * `which` is the workflow input verbatim: `undefined` or empty/whitespace means
 * *all*, anything else names a single source. A named source absent from the
 * registry **throws** rather than falling back to a full run — a typo at the
 * dispatch box must fail loudly, not silently scrape everything the operator was
 * trying to avoid.
 */
export const selectRun = (
  registry: (Source<VenueEvent> | Source<PortCall>)[],
  manifests: Record<SourceId, SourceManifest>,
  which: string | undefined,
): RunSelection => {
  const named = which?.trim();

  const needsBrowser = (sources: (Source<VenueEvent> | Source<PortCall>)[]): boolean =>
    sources.some((source) => manifests[source.key]?.needsBrowser === true);

  if (!named) {
    return { sources: registry, needsBrowser: needsBrowser(registry), full: true };
  }

  const source = registry.find((candidate) => candidate.key === named);
  if (!source) {
    const known = registry.map((candidate) => candidate.key).join(", ");
    throw new Error(`Unknown source "${named}". Known sources: ${known}.`);
  }

  return { sources: [source], needsBrowser: needsBrowser([source]), full: false };
};
