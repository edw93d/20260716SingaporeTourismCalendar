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
 * open a new one, and close an existing one. Deliberately not a general issue
 * client — nothing here edits, labels, or reads bodies beyond finding the marker.
 */
export type IssueGateway = {
  /** The open health issue for this source, or `null` if none is open. */
  findOpen(source: SourceId): Promise<OpenIssue | null>;
  /** Open a new health issue for the source. */
  open(source: SourceId, title: string, body: string): Promise<void>;
  /** Close an open issue, leaving a closing comment. */
  close(issue: OpenIssue, comment: string): Promise<void>;
};

/**
 * The hidden identity marker embedded in every health issue's body. Machine
 * identity lives here, not in the title, so an operator retitling the issue
 * while triaging does not orphan it. The reconciler finds a source's open issue
 * by scanning open bodies for this exact string.
 */
export const markerFor = (source: SourceId): string => `<!-- scraper-health:${source} -->`;

/** `Scraper unhealthy: scc` — the source is the operator's unit of action. */
export const issueTitle = (source: SourceId): string => `Scraper unhealthy: ${source}`;

/** One signal rendered as a Markdown section, debuggable without re-scraping. */
const renderSignal = (signal: BreakageSignal): string => {
  switch (signal.kind) {
    case "unreadable":
      return `### The source could not be read\n\n${signal.reason}`;
    case "rows-failed":
      // The failing fragment and the parser's expectation travel with the alert,
      // so the adapter can be fixed from the issue alone (ADR-0007's criterion).
      return [
        `### ${signal.failures.length} row(s) failed to parse`,
        ...signal.failures.map(
          (failure) =>
            `- expected **${failure.expected}**` +
            (failure.sourceKey ? ` for \`${failure.sourceKey}\`` : "") +
            `, in:\n\n  \`\`\`\n  ${failure.fragment.replace(/\n/g, "\n  ")}\n  \`\`\``,
        ),
      ].join("\n");
    case "cohort-drop":
      return [
        "### The future-dated cohort dropped",
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
        // adds nothing, so the already-open issue is left untouched.
        if (!existing) {
          await gateway.open(source, issueTitle(source), issueBody(source, signals));
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
