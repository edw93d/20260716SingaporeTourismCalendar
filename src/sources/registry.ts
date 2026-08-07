import type { PortCall, SourceId, VenueEvent } from "../domain/types.js";
import { mbccs, mbccsManifest } from "./mbccs.js";
import { scc, sccManifest } from "./scc.js";
import { suntec, suntecManifest } from "./suntec.js";
import type { Source, SourceManifest } from "./types.js";

/**
 * Every source that feeds this calendar. One file answers "what feeds this?".
 *
 * **Explicit by decision** (ADR-0005). No filesystem discovery, no
 * self-registration, no `enabled` flag:
 *
 * - Discovery fails the deletion test — nothing of value is lost, it only saves
 *   typing the line that should be typed — and degrades typing to `any` at the
 *   glob boundary, discarding the type parameter.
 * - An `enabled` flag reintroduces a config system through the side door.
 *   Disabling a source is a **one-line revertable diff**, which matters because
 *   SCC's Imperva is passive but one switch-flip from defending.
 *
 * Adding a source touches two files — the module and this array. That is the
 * point, not overhead.
 */
export const sources: (Source<VenueEvent> | Source<PortCall>)[] = [suntec, scc, mbccs];

/**
 * Each source's manifest metadata (ADR-0028 §6), keyed by source id. Kept beside
 * the registry — not on the `Source` objects — so the contract stays
 * `key`/`fetch`/`parse` while a run can still read `needsBrowser` before it
 * starts. A source and its manifest are added together; the architecture test
 * holds that this map's keys are exactly the registry's, so a source added
 * without a manifest (or a manifest left behind after a source is removed) fails
 * the build rather than launching the wrong browser or none at all.
 */
export const manifests: Record<SourceId, SourceManifest> = {
  [suntec.key]: suntecManifest,
  [scc.key]: sccManifest,
  [mbccs.key]: mbccsManifest,
};
