import type { SourceId } from "../domain/types.js";
import type { BreakageSignal } from "../pipeline/breakage.js";
import type { SourceBreakage } from "../pipeline/run.js";

/**
 * Turning breakage signals into operator alerts (ADR-0007 §6, #41).
 *
 * **The alert is a GitHub issue, because a break is stateful and an issue is the
 * only channel here with state.** It opens, gets triaged, and closes when fixed.
 * The pipeline runs daily, so a stateless channel — email, a log line, a digest
 * — would emit one identical message per day per break, and dedup would become
 * something the operator does by ignoring repeats. That is alert fatigue in a
 * smaller costume, and it is the failure this whole ticket exists to avoid.
 *
 * Two rules follow, and are enforced here:
 *
 * - **Exactly one open issue per source.** Identity is the source, not the
 *   signal: a redesign trips the anchor and the row parser at once, one cause,
 *   one fix, and "open the SCC adapter and look at it" is the operator's unit of
 *   action. A second consecutive broken run must *not* open a second issue.
 * - **Auto-close on recovery.** The likeliest break is a transient Imperva
 *   challenge, which self-resolves; leaving the issue open would manufacture
 *   manual work and train the operator to close issues without reading them.
 *
 * This module holds no credential and speaks to no network. It drives an
 * injected {@link IssueGateway}, so the open/close policy is testable without
 * GitHub and the one place that authenticates — `gh`, with `GITHUB_TOKEN` from
 * its inherited environment — stays at the edge.
 */

/** An open health issue, identified by its number. */
export type OpenIssue = { number: number };

/**
 * The narrow surface the reconciler needs: find the one open issue for a source,
 * open one, close one, append a late-appearing signal as a comment, and read
 * back which signal kinds already landed on it. Deliberately not a general issue
 * client — it reads bodies and comments only to scan for the health and signal
 * markers, and writes only issues and their comments; it never edits or labels.
 */
export type IssueGateway = {
  /** The open health issue for this source, or `null` if none is open. */
  findOpen(source: SourceId): Promise<OpenIssue | null>;
  /** Open a new health issue for the source. */
  open(source: SourceId, title: string, body: string): Promise<void>;
  /** Close an open issue, leaving a closing comment. */
  close(issue: OpenIssue, comment: string): Promise<void>;
  /** Append a comment to an open issue — a late-appearing signal (§6, #55). */
  comment(issue: OpenIssue, body: string): Promise<void>;
  /**
   * The signal kinds already represented on the issue — read from its body and
   * every comment — so a kind is commented once and never re-posted daily.
   */
  landed(issue: OpenIssue): Promise<BreakageSignal["kind"][]>;
};

/**
 * The signal kinds, enumerated for the marker scan. `satisfies Record<…, true>`
 * makes the compiler reject this list if a new {@link BreakageSignal} kind is
 * added without a marker here — the one place a kind can be silently forgotten.
 */
const SIGNAL_KIND_SET = {
  unreadable: true,
  "rows-failed": true,
  "cohort-drop": true,
} as const satisfies Record<BreakageSignal["kind"], true>;

const SIGNAL_KINDS = Object.keys(SIGNAL_KIND_SET) as BreakageSignal["kind"][];

/**
 * Each kind's section heading text — the single source of truth, used both to
 * render the section ({@link renderSignalSection}) and, as a fallback to the
 * hidden marker, to detect a kind already present ({@link landedKinds}). The
 * fallback matters because issues opened before #55 carry no signal marker: the
 * heading is the only kind-identifying string in such a body, and without it a
 * pre-marker issue would re-comment every kind daily — the noise §6 forbids.
 */
const SIGNAL_HEADINGS = {
  unreadable: "The source could not be read",
  "rows-failed": "row(s) failed to parse",
  "cohort-drop": "The future-dated cohort dropped",
} as const satisfies Record<BreakageSignal["kind"], string>;

/**
 * The hidden per-kind marker embedded in each rendered signal. It rides in the
 * issue body when a kind opens the issue and in the comment when a kind lands
 * later, so {@link IssueGateway.landed} can tell what a source's issue already
 * carries by scanning for these strings — the same title-edit-proof trick as
 * {@link markerFor}, one level down.
 */
export const signalMarker = (kind: BreakageSignal["kind"]): string => `<!-- signal:${kind} -->`;

/**
 * The signal kinds already represented in the given issue text — its body and
 * comments joined. A kind counts as present if its hidden marker appears, or —
 * for issues opened before markers existed (#55) — if its section heading does.
 */
export const landedKinds = (text: string): BreakageSignal["kind"][] =>
  SIGNAL_KINDS.filter(
    (kind) => text.includes(signalMarker(kind)) || text.includes(SIGNAL_HEADINGS[kind]),
  );

/**
 * The hidden identity marker embedded in every health issue's body. Machine
 * identity lives here, not in the title, so an operator retitling the issue
 * while triaging does not orphan it. The reconciler finds a source's open issue
 * by scanning open bodies for this exact string.
 */
export const markerFor = (source: SourceId): string => `<!-- scraper-health:${source} -->`;

/** `Scraper unhealthy: scc` — the source is the operator's unit of action. */
export const issueTitle = (source: SourceId): string => `Scraper unhealthy: ${source}`;

/** The Markdown body of one signal, without its trailing identity marker. */
const renderSignalSection = (signal: BreakageSignal): string => {
  switch (signal.kind) {
    case "unreadable":
      return `### ${SIGNAL_HEADINGS.unreadable}\n\n${signal.reason}`;
    case "rows-failed":
      // The failing fragment and the parser's expectation travel with the alert,
      // so the adapter can be fixed from the issue alone (ADR-0007's criterion).
      return [
        `### ${signal.failures.length} ${SIGNAL_HEADINGS["rows-failed"]}`,
        ...signal.failures.map(
          (failure) =>
            `- expected **${failure.expected}**` +
            (failure.sourceKey ? ` for \`${failure.sourceKey}\`` : "") +
            `, in:\n\n  \`\`\`\n  ${failure.fragment.replace(/\n/g, "\n  ")}\n  \`\`\``,
        ),
      ].join("\n");
    case "cohort-drop":
      return [
        `### ${SIGNAL_HEADINGS["cohort-drop"]}`,
        "",
        `- vanished: **${signal.vanished}**`,
        `- appeared: **${signal.appeared}**`,
        `- net drop: **${signal.vanished - signal.appeared}**`,
        "",
        "A net drop this size is a broken selector, not a run of cancellations —" +
          " the anchor still matched and the surviving rows parsed cleanly, which" +
          " is the quiet failure a parser cannot see for itself (ADR-0007).",
      ].join("\n");
  }
};

/**
 * One signal rendered as a Markdown section, debuggable without re-scraping,
 * carrying its hidden kind marker so a later run can tell it already landed.
 */
const renderSignal = (signal: BreakageSignal): string =>
  `${renderSignalSection(signal)}\n\n${signalMarker(signal.kind)}`;

/**
 * The body of a freshly opened health issue: a human explanation, every signal
 * from the run that opened it, and the hidden identity marker last.
 */
export const issueBody = (source: SourceId, signals: BreakageSignal[]): string =>
  [
    `The \`${source}\` scraper looks broken. This issue was opened automatically` +
      ` by the daily pipeline (ADR-0007, #41) and will **auto-close** on the next` +
      ` run in which the source reads cleanly.`,
    "",
    ...signals.map(renderSignal),
    "",
    markerFor(source),
  ].join("\n");

/**
 * The comment appended when a source stays broken but trips a signal kind the
 * open issue does not yet carry (ADR-0007 §6, #55) — e.g. it first tripped only
 * `cohort-drop` (which carries no fragment), then `rows-failed` on a later run.
 * It renders the signal with the same detail the opening body would, so the
 * issue stays debuggable without re-scraping, and carries the kind marker so it
 * is never re-posted on subsequent broken runs.
 */
export const lateSignalComment = (source: SourceId, signal: BreakageSignal): string =>
  [
    `A new failure mode appeared for \`${source}\` while this issue was open, so` +
      ` the daily pipeline appended it (ADR-0007 §6, #55). The issue stays open;` +
      ` this is added detail, not a second alert.`,
    "",
    renderSignal(signal),
  ].join("\n");

/** The comment left when a source recovers and its issue is auto-closed. */
export const recoveryComment = (source: SourceId): string =>
  `The \`${source}\` scraper read cleanly again in the latest daily run —` +
  ` auto-closing (ADR-0007). Reopens if it breaks again.`;

/**
 * Reconcile this run's breakage against the open issues: open one where a source
 * is newly broken, leave the existing one alone where it is still broken, and
 * close it where the source has recovered.
 *
 * Each source is reconciled independently, so one source's gateway error does
 * not suppress another's alert. Errors are collected and thrown together after
 * every source has been attempted; the caller logs them without failing the
 * run, since the feeds were already published before alerting began.
 */
export const reconcile = async (
  breakage: SourceBreakage[],
  gateway: IssueGateway,
): Promise<void> => {
  const errors: unknown[] = [];

  for (const { source, signals } of breakage) {
    try {
      const existing = await gateway.findOpen(source);

      if (signals.length > 0) {
        // Exactly one open issue per source: a second consecutive broken run
        // opens nothing new. But a run whose failure mode has shifted category
        // may carry a signal kind the issue does not yet hold — append only
        // those, once each, so the issue gains the new detail without the
        // daily-repeat noise §6 exists to avoid.
        if (!existing) {
          await gateway.open(source, issueTitle(source), issueBody(source, signals));
        } else {
          const present = new Set(await gateway.landed(existing));
          for (const signal of signals) {
            if (present.has(signal.kind)) continue;
            present.add(signal.kind); // a kind lands once, even if a run repeats it
            await gateway.comment(existing, lateSignalComment(source, signal));
          }
        }
      } else if (existing) {
        await gateway.close(existing, recoveryComment(source));
      }
    } catch (error) {
      errors.push(error);
    }
  }

  if (errors.length > 0) {
    throw new AggregateError(errors, `alert reconciliation failed for ${errors.length} source(s)`);
  }
};
