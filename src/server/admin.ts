import { toDate } from "../domain/instant.js";
import type { Instant } from "../domain/instant.js";
import type { ModerationFlag, SourceId, VenueEvent } from "../domain/types.js";

/**
 * The moderator spreadsheet's markup, built from the store's `VenueEvent[]`
 * (#155, ADR-0024, ADR-0030). A **read-only** table for now — one row per
 * record, every record, including the hidden and the unreviewed: the admin read
 * shows everything the public projection filters, because the boundary between
 * public and operator is the auth guard in front of this page (ADR-0030 §5), not
 * what the query returns. The state pills toggle (#156) and the whole table
 * filters, sorts and bulk-moderates (#157) once `site/admin/client.js` attaches;
 * the hand-entry form is a later ticket (#158).
 *
 * The rendering stays a **pure function of its inputs**, and carries the client's
 * behaviour as **data on the markup** rather than as logic here: each date cell's
 * `data-facet`/`data-sort` and each header's `data-key`/`data-funnel` are what let
 * a generic grid client filter and sort without the server shipping any script.
 * The column set, the SGT surfacing and the escaping are pinned without a socket
 * (`tests/admin.test.ts`); the request handler passes the store's rows and a
 * lookup for the ADR-0020 descriptions.
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
 * The SGT month a record falls in, as `Jul 2026` — the value the Start/End funnel
 * filters group by (#157). Excel-style date funnels group by month rather than by
 * the per-minute cell value, so "one venue in one month across all sources" is one
 * checkbox, not thirty. Fixed to the Singapore zone like the other two, so a
 * record's month is the month the moderator reads it in, not UTC's.
 */
const sgtMonth = new Intl.DateTimeFormat("en-GB", {
  timeZone: SINGAPORE,
  month: "short",
  year: "numeric",
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
 * state; `site/admin/client.js` attaches the toggle on load, so a click flips the
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

/**
 * A date cell, carrying the two keys the client's grid reads off the DOM (#157)
 * alongside the human-readable SGT text: `data-facet` is the **month** the funnel
 * filter groups by, and `data-sort` is the instant as **epoch milliseconds** so a
 * click-label sort orders chronologically rather than by the alphabetised
 * display string. Epoch ms is a display-neutral key — it never surfaces the stored
 * UTC wall-clock the SGT text deliberately hides.
 */
const dateCell = (value: Instant, className: string): string => {
  const at = toDate(value);
  return `<td class="${className}" data-facet="${sgtMonth.format(at)}" data-sort="${at.getTime()}">${formatSgt(value)}</td>`;
};

/**
 * The columns, in order — the label the header shows, the stable `key` the client
 * addresses a column by (for sort and for reading each row's cell), and whether
 * the column carries a **funnel filter** (#157). Every column is sortable by its
 * label; only some are worth funnelling. `Event` is deliberately not funnelled —
 * it is free text with ~one distinct value per row, so a funnel of it would list
 * the whole table and filter nothing useful. The client injects the funnel control
 * into a `[data-funnel]` header on load, so a header renders as plain, legible text
 * without JS rather than as a dead control.
 */
const HEADERS: ReadonlyArray<{ label: string; key: string; funnel: boolean }> = [
  { label: "Source", key: "source", funnel: true },
  { label: "Event", key: "name", funnel: false },
  { label: "Venue", key: "venue", funnel: true },
  { label: "Start (SGT)", key: "start", funnel: true },
  { label: "End (SGT)", key: "end", funnel: true },
  { label: "Review state", key: "reviewed", funnel: true },
  { label: "Shown on calendar", key: "hidden", funnel: true },
];

const headerCells = (): string =>
  HEADERS.map(
    ({ label, key, funnel }) =>
      `<th data-key="${key}"${funnel ? " data-funnel" : ""}>${escapeHtml(label)}</th>`,
  ).join("\n        ");

const row = (record: VenueEvent, describe: SourceDescription): string => `
      <tr data-uid="${escapeHtml(record.uid)}">
        <td class="source">${sourceCell(record.source, describe)}</td>
        <td class="name">${escapeHtml(record.name)}</td>
        <td class="venue">${escapeHtml(record.venue)}</td>
        ${dateCell(record.start, "start")}
        ${dateCell(record.end, "end")}
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
    .toast { position: fixed; left: 50%; bottom: 4rem; transform: translateX(-50%);
      background: #111; color: #fff; padding: 8px 14px; border-radius: 6px; z-index: 20;
      display: flex; gap: 12px; align-items: center; box-shadow: 0 2px 8px rgba(0,0,0,0.3); }
    .toast button { font: inherit; color: #7db4ff; background: none; border: none;
      cursor: pointer; text-decoration: underline; padding: 0; }

    /* The column header is a sort control (#157): the whole cell is clickable, and
       an injected funnel button opens the filter menu without triggering a sort. */
    th { cursor: pointer; user-select: none; }
    th[aria-sort="ascending"]::after { content: " ▲"; color: #888; }
    th[aria-sort="descending"]::after { content: " ▼"; color: #888; }
    .funnel { font: inherit; cursor: pointer; border: none; background: none; color: #888;
      padding: 0 2px; margin-left: 4px; }
    .funnel[aria-expanded="true"], th.filtered .funnel { color: #111; font-weight: 700; }
    th.filtered { background: #eef4ff; }
    .menu { position: absolute; top: 100%; left: 0; z-index: 30; min-width: 12rem;
      max-height: 16rem; overflow-y: auto; background: #fff; border: 1px solid #bbb;
      border-radius: 6px; box-shadow: 0 2px 8px rgba(0,0,0,0.2); padding: 6px; font-weight: 400; }
    .menu label { display: flex; gap: 8px; align-items: center; padding: 3px 4px; cursor: pointer;
      white-space: nowrap; }
    .menu .menu-actions { display: flex; gap: 12px; padding: 4px; border-bottom: 1px solid #eee;
      margin-bottom: 4px; }
    .menu .menu-actions button { font: inherit; background: none; border: none; color: #06c;
      cursor: pointer; text-decoration: underline; padding: 0; }

    /* The filter-then-bulk bar (#157): fixed, always visible, acting on exactly the
       rows the funnel filters leave showing. */
    .bulkbar { position: fixed; left: 0; right: 0; bottom: 0; z-index: 10;
      display: flex; gap: 12px; align-items: center; background: #111; color: #fff;
      padding: 8px 16px; box-shadow: 0 -2px 8px rgba(0,0,0,0.3); }
    .bulkbar .count { font-weight: 700; }
    .bulkbar button { font: inherit; cursor: pointer; border: 1px solid #666; border-radius: 4px;
      background: #222; color: #fff; padding: 3px 12px; }
    .bulkbar button:hover { background: #333; }
    table { margin-bottom: 3.5rem; } /* keep the last rows clear of the fixed bulk bar */

    /* Hand-entry (#158): a prominent ＋ button, and a centred modal over a backdrop.
       The modal is display:flex when open, so its [hidden] state needs an explicit
       display:none — an author display rule otherwise beats the UA [hidden] rule. */
    .add-event { position: fixed; top: 1.5rem; right: 1.5rem; z-index: 15; font: inherit;
      cursor: pointer; border: 1px solid #0a6; border-radius: 6px; background: #0a6; color: #fff;
      padding: 6px 14px; box-shadow: 0 1px 4px rgba(0,0,0,0.2); }
    .add-event:hover { background: #097; }
    .entry-modal { position: fixed; inset: 0; z-index: 40; display: flex; align-items: center;
      justify-content: center; background: rgba(0,0,0,0.4); }
    .entry-modal[hidden] { display: none; }
    .entry-form { background: #fff; border-radius: 8px; padding: 20px; width: min(28rem, 92vw);
      box-shadow: 0 4px 20px rgba(0,0,0,0.3); display: flex; flex-direction: column; gap: 12px; }
    .entry-field { display: flex; flex-direction: column; gap: 3px; }
    .entry-field span { font-weight: 600; }
    .entry-field input { font: inherit; padding: 5px 7px; border: 1px solid #bbb; border-radius: 4px; }
    .entry-error { margin: 0; color: #c00; font-weight: 600; }
    .entry-actions { display: flex; justify-content: flex-end; gap: 10px; }
    .entry-actions button { font: inherit; cursor: pointer; border-radius: 4px; padding: 5px 14px; }
    .entry-cancel { border: 1px solid #bbb; background: #fff; color: #111; }
    .entry-submit { border: 1px solid #0a6; background: #0a6; color: #fff; }`;

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
        ${headerCells()}
      </tr>
    </thead>
    <tbody>${rows}
    </tbody>
  </table>
  <script type="module">
    import { mountAdmin } from "/admin/client.js";
    mountAdmin(document.body, { fetch: (...args) => window.fetch(...args) });
  </script>
</body>
</html>
`;
};
