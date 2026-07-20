import type { PortCall, VenueEvent } from "../domain/types.js";
import type { Source } from "./types.js";

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
export const sources: (Source<VenueEvent> | Source<PortCall>)[] = [];
