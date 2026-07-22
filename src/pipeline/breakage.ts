import { instantFromDate } from "../domain/instant.js";
import type { DomainRecord, PortCall, Scraped, VenueEvent } from "../domain/types.js";
import type { ParseFailure } from "../sources/types.js";
import type { SourceOutcome } from "./run.js";

/**
 * A freshly scraped record, either type. Written as an explicit union rather
 * than `Scraped<DomainRecord>` because `Omit` over a union keeps only the keys
 * common to both members — which would drop the very `end`/`departure` fields
 * the cohort boundary is read from.
 */
type ScrapedRecord = Scraped<VenueEvent> | Scraped<PortCall>;

/**
 * Breakage detection — the core reading the history the store already keeps, to
 * catch the one failure a parser structurally cannot (ADR-0007, #41).
 *
 * Three of the four alert signals are already visible at the point a source is
 * read: a `fetch` that threw post-retry and a not-ok `parse` both land as an
 * `ok: false` outcome, and a non-empty `failures[]` rides on an ok one. Those
 * are per-run facts the parser hands up.
 *
 * **The fourth is why this module exists.** A parser sees exactly one run — it
 * has no yesterday — so the quiet redesign, where the anchor still matches and
 * rows drop 40 → 3 with every survivor parsing cleanly, is invisible to it by
 * construction. Catching it needs the cross-run memory ADR-0004 persists, which
 * only the core holds. This is that comparison, and nothing more: a suspicion
 * addressed to the operator, never a `status` written back onto a record
 * (ADR-0007 §7).
 */

/**
 * A net drop of **≥3** in the future-dated cohort fires. Flat across every
 * source, because size is the wrong denominator (ADR-0007 §3): the healthy
 * baseline is ~0 at every source, so a percentage measures against nothing, and
 * on SCC's 16 rows it would quantise into 6.25% steps. The noise is −1 or −2 (a
 * cancellation, or two same day); the signal is −16 or −124 (a dead selector).
 * The gap is more than an order of magnitude, so anything from 3 to 10 behaves
 * identically — the tell that per-source tuning buys precision that does not
 * exist. Deliberately **unequal** to #17's ≥2-day reader-facing escalation:
 * different signals, different axes, both live.
 */
export const NET_DROP_THRESHOLD = 3;

/**
 * The net change in a source's future-dated cohort across two runs. `vanished`
 * counts records present in the last run's cohort and absent now; `appeared`
 * counts records observed now, future-dated, and not in that cohort. A cohort
 * **drop** — the alerting signal — is `vanished − appeared`.
 */
export type CohortDelta = {
  vanished: number;
  appeared: number;
};

/**
 * One reason a source is unhealthy this run. The three kinds are the alerting
 * layer's whole input: an `ok: false` outcome (fetch threw post-retry, or the
 * anchor was absent), rows that failed to parse, and a cohort drop. All three
 * land on the **one** open issue per source — a redesign trips the anchor and
 * the row parser at once, one cause, one fix (ADR-0007 §6).
 */
export type BreakageSignal =
  | { kind: "unreadable"; reason: string }
  | { kind: "rows-failed"; failures: ParseFailure[] }
  | { kind: "cohort-drop"; vanished: number; appeared: number };

/**
 * The end of a record's occupancy of the future — `departure` for a `PortCall`,
 * `end` for a `VenueEvent`. Told apart on the one field only a port call has,
 * exactly as the pipeline discriminates the two record types on the wire; there
 * is no tag, and the domain types are honest separate shapes. Works on a stored
 * record and on a freshly scraped one alike, which is what lets one comparison
 * serve both sides of the delta.
 */
const endOf = (record: DomainRecord | ScrapedRecord): string =>
  "departure" in record ? record.departure : record.end;

/**
 * The net change in the future-dated cohort between the last run and this one.
 *
 * `previous` is every record the store held for this source **before** this
 * run's upsert; `observed` is what the source returned this run. Both qualifiers
 * from ADR-0007 §2 are load-bearing and applied here:
 *
 * - **Future-dated, relative to *now*.** The previous cohort is the last run's
 *   observations that are *still* ahead of `now`, so a conference that merely
 *   happened has already exited the cohort by date and cannot count as vanished.
 *   That is what makes the healthy baseline net-zero-or-positive at every size.
 * - **Net.** Appearances offset vanishings, which discriminates on precisely the
 *   axis that separates the two causes. SCC's `sourceKey` is `{vessel}|{date}`,
 *   so a reschedule is a delete-plus-create (ADR-0004) — one vanish, one
 *   appearance, net zero — and netting silences it *by construction* rather than
 *   by tuning a threshold above it.
 *
 * The previous cohort is scoped to the last run's observations by taking only
 * records whose `lastSeenAt` equals the newest `lastSeenAt` present — every
 * record upserted in a run shares that run's instant, so the newest value names
 * the last run that actually saw data. Records that stopped appearing several
 * runs ago are never hard-deleted (ADR-0004) but carry an older `lastSeenAt`, so
 * they are not re-counted as vanishing every day.
 *
 * `vanished` compares against *all* observed keys, not just the future-dated
 * ones: a key still on the listing has not vanished even if it slipped into the
 * past between the two runs.
 */
export const cohortDelta = (
  previous: DomainRecord[],
  observed: ScrapedRecord[],
  now: Date,
): CohortDelta => {
  const nowInstant = instantFromDate(now);

  const lastSeen = previous.reduce<string | null>(
    (newest, record) =>
      newest === null || record.lastSeenAt > newest ? record.lastSeenAt : newest,
    null,
  );

  const previousCohort = new Set(
    previous
      .filter((record) => record.lastSeenAt === lastSeen && endOf(record) > nowInstant)
      .map((record) => record.sourceKey),
  );

  const observedKeys = new Set(observed.map((record) => record.sourceKey));
  const observedFuture = new Set(
    observed.filter((record) => endOf(record) > nowInstant).map((record) => record.sourceKey),
  );

  const vanished = [...previousCohort].filter((key) => !observedKeys.has(key)).length;
  const appeared = [...observedFuture].filter((key) => !previousCohort.has(key)).length;

  return { vanished, appeared };
};

/**
 * The breakage signals for one source this run, from its outcome and — when it
 * was readable — the cohort delta.
 *
 * When `parse` returned `ok: false`, drift detection is **skipped entirely**
 * (ADR-0007 §4): the anchor was absent, which reads as a 100% drop and would
 * fire a second, misleading alert about mass cancellation on top of the honest
 * "the page isn't ours." So `delta` is `null` for an unreadable source, and the
 * one signal raised is the unreadable one.
 *
 * A genuinely empty listing raises nothing on its own: emptiness is not a
 * signal, only a *drop from a populated cohort* is. `records: []` with no prior
 * cohort nets to zero and stays silent (ADR-0006's "genuinely empty. A fact.").
 */
export const assess = (
  outcome: SourceOutcome,
  delta: CohortDelta | null,
): BreakageSignal[] => {
  if (!outcome.ok) {
    return [{ kind: "unreadable", reason: outcome.reason }];
  }

  const signals: BreakageSignal[] = [];

  // The good records already landed (ADR-0006): failing rows are reported, never
  // dropped, so a scraper defect is not laundered into a domain absence.
  if (outcome.failures.length > 0) {
    signals.push({ kind: "rows-failed", failures: outcome.failures });
  }

  if (delta !== null && delta.vanished - delta.appeared >= NET_DROP_THRESHOLD) {
    signals.push({ kind: "cohort-drop", vanished: delta.vanished, appeared: delta.appeared });
  }

  return signals;
};
