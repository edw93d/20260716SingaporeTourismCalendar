import { toDate } from "../domain/instant.js";
import type { Instant } from "../domain/instant.js";
import type { ModerationFlag, SourceId, VenueEvent } from "../domain/types.js";

/**
 * The moderator spreadsheet's markup, built from the store's `VenueEvent[]`
 * (#155, ADR-0024, ADR-0030). A **read-only** table for now — one row per
 * record, every record, including the hidden and the unreviewed: the admin read
 * shows everything the public projection filters, because the boundary between
 * public and operator is the auth guard in front of this page (ADR-0030 §5), not
 * what the query returns. The state pills, the funnel filters and the hand-entry
 * form are later tickets (#156/#157/#158); this proves the boundary and the table.
 *
 * It is a **pure function of its inputs** so the column set, the SGT surfacing and
 * the escaping are pinned without a socket (`tests/admin.test.ts`); the request
 * handler passes the store's rows and a lookup for the ADR-0020 descriptions.
 */

/** Resolves a source's admin-facing description (ADR-0020) — absent for `manual`. */
export type SourceDescription = (source: SourceId) => string | undefined;

const SINGAPORE = "Asia/Singapore";

/**
 * The moderator reads in Singapore time; storage stays UTC (ADR-0003). Two
 * formatters, both fixed to the Singapore zone: the date as `17 Jul 2026`, the
 * wall-clock as 24-hour `12:00`. `en-GB` gives that day/month/year order and a
 * 24-hour clock without a locale surprise.
 */
const sgtDate = new Intl.DateTimeFormat("en-GB", {
  timeZone: SINGAPORE,
  day: "2-digit",
  month: "short",
  year: "numeric",
});
const sgtTime = new Intl.DateTimeFormat("en-GB", {
  timeZone: SINGAPORE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

/**
 * A UTC instant as the moderator sees it: SGT date and time, surfaced **before**
 * the calendar flattens it to all-day, so a duplicate's time discrepancy shows in
 * the exact field the grid hides.
 *
 * A wall-clock of midnight in Singapore is the shape a genuinely date-only source
 * lands as — the model has no all-day instant (ADR-0003), so a date-only value
 * can only arrive filled to local midnight. That is rendered as `—`, never a
 * faked `00:00`, so absence is never mistaken for a real midnight start.
 */
const formatSgt = (value: Instant): string => {
  const at = toDate(value);
  const date = sgtDate.format(at);
  const time = sgtTime.format(at);
  return time === "00:00" ? `${date}, —` : `${date}, ${time}`;
};

/** Escapes text for HTML — record names and venues are untrusted scraped strings. */
const escapeHtml = (value: string): string =>
  value.replace(/[&<>"']/g, (char) => {
    switch (char) {
      case "&":
        return "&amp;";
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case '"':
        return "&quot;";
      default:
        return "&#39;";
    }
  });

/**
 * The source cell: the **bare source key**, with the ADR-0020 admin-facing
 * description on hover — no separate column (#155). A source with no manifest
 * description (a `manual` hand-entry, later) shows the key alone, no tooltip.
 */
const sourceCell = (source: SourceId, describe: SourceDescription): string => {
  const description = describe(source);
  if (description === undefined) return escapeHtml(source);
  return `<span title="${escapeHtml(description)}">${escapeHtml(source)}</span>`;
};

/**
 * A state cell as a clickable **pill** (#156). The server renders the current
 * state; `site/admin-client.js` attaches the toggle on load, so a click flips the
 * flag under the auth boundary and raises an Undo toast. `data-flag` names the
 * `VenueEvent` boolean this pill sets (`reviewed`, or `hidden` for the Shown
 * column) and `data-value` carries that boolean's current value, so the client
 * knows which way to flip without re-reading the label. The button's text is the
 * same state word #155 rendered, so the read-only story survives without JS: the
 * flags are still legible, just not yet toggleable.
 */
const pill = (flag: ModerationFlag, value: boolean, label: string): string =>
  `<button type="button" class="pill" data-flag="${flag}" data-value="${value}" aria-pressed="${value}">${label}</button>`;

const reviewPill = (reviewed: boolean): string =>
  pill("reviewed", reviewed, reviewed ? "Reviewed" : "Unreviewed");

const shownPill = (hidden: boolean): string => pill("hidden", hidden, hidden ? "Hidden" : "Shown");

const row = (record: VenueEvent, describe: SourceDescription): string => `
      <tr data-uid="${escapeHtml(record.uid)}">
        <td class="source">${sourceCell(record.source, describe)}</td>
        <td class="name">${escapeHtml(record.name)}</td>
        <td class="venue">${escapeHtml(record.venue)}</td>
        <td class="start">${formatSgt(record.start)}</td>
        <td class="end">${formatSgt(record.end)}</td>
        <td class="review-state">${reviewPill(record.reviewed)}</td>
        <td class="shown-state">${shownPill(record.hidden)}</td>
      </tr>`;

const STYLE = `
    body { font: 14px/1.4 system-ui, sans-serif; margin: 1.5rem; color: #111; }
    h1 { font-size: 1.1rem; }
    table { border-collapse: collapse; width: 100%; }
    th, td { border: 1px solid #ddd; padding: 4px 8px; text-align: left; vertical-align: top; }
    th { background: #f5f5f5; position: sticky; top: 0; }
    .source span { cursor: help; border-bottom: 1px dotted #999; }
    caption { text-align: left; color: #666; padding-bottom: 0.5rem; }
    .pill { font: inherit; cursor: pointer; border: 1px solid #bbb; border-radius: 999px;
      padding: 1px 10px; background: #fff; color: inherit; }
    .pill[aria-pressed="true"] { background: #111; color: #fff; border-color: #111; }
    .pill[disabled] { opacity: 0.5; cursor: progress; }
    .toast { position: fixed; left: 50%; bottom: 1.5rem; transform: translateX(-50%);
      background: #111; color: #fff; padding: 8px 14px; border-radius: 6px;
      display: flex; gap: 12px; align-items: center; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
    .toast button { font: inherit; color: #7db4ff; background: none; border: none;
      cursor: pointer; text-decoration: underline; padding: 0; }`;

/**
 * Renders the read-only moderator spreadsheet as a whole HTML document. The
 * `describe` lookup resolves each source's ADR-0020 description for the hover;
 * the caller wires it to the source registry's manifests.
 */
export const renderAdminPage = (
  venueEvents: VenueEvent[],
  describe: SourceDescription,
): string => {
  const rows = venueEvents.map((record) => row(record, describe)).join("");
  const count = venueEvents.length;
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Moderator spreadsheet</title>
  <style>${STYLE}
  </style>
</head>
<body>
  <h1>Moderator spreadsheet</h1>
  <table>
    <caption>${count} record${count === 1 ? "" : "s"} — every listing, including hidden and unreviewed. Times shown in Singapore time (SGT); storage is UTC.</caption>
    <thead>
      <tr>
        <th>Source</th>
        <th>Event</th>
        <th>Venue</th>
        <th>Start (SGT)</th>
        <th>End (SGT)</th>
        <th>Review state</th>
        <th>Shown on calendar</th>
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
  <script type="module">
    import { mountAdmin } from "/admin-client.js";
    mountAdmin(document.body, { fetch: (...args) => window.fetch(...args) });
  </script>
</body>
</html>
`;
};
