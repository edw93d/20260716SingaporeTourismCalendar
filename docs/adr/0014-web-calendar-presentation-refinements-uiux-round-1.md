# ADR-0014: Web calendar presentation refinements from the UI/UX prototype round

- **Status:** Accepted
- **Date:** 2026-07-24
- **Ticket:** UI/UX prototype grilling round (product-owner-led; no single issue)
- **Primary source:** prototype on branch
  [`prototype/calendar-uiux-round-1`](https://github.com/edw93d/20260716SingaporeTourismCalendar/tree/prototype/calendar-uiux-round-1/prototype/month-compression-5) —
  items 1–21 over the real July 2026 dataset. Throwaway; **not merged to `main`.**
- **Refines:** ADR-0009 (the month `+N more` overflow — names Agenda as the drill
  target and corrects the implementation's deviation; see ADR-0009 Amendment 1).

## Context

ADR-0009 settled the web calendar's **shape** (four switchable views, Month as the
default navigator) from an earlier throwaway prototype. A second, product-owner-led
prototype round — `prototype/calendar-uiux-round-1`, items 1–21 — refined the
**presentation** of that shape against the real dataset.

Most of those items are net-new presentation choices that the forthcoming
implementation spec will carry directly. **This ADR records only the three that
reverse, narrow, or correct a decision already written down**, so the built product
does not silently contradict an Accepted ADR, a closed issue's acceptance criteria,
or a load-bearing code comment. It is deliberately **not** the full round-1 spec.

(Two production bugs the round surfaced — the Week all-day lane-packing off-by-one in
`assignLanes`, and the weekend-wash positional coupling — are implementation defects,
not decisions, and are tracked in the round's handoff, not here.)

## Decision

### 1. Month is fixed to one screen, capped, with `+N more` drilling to Agenda

ADR-0009's Consequences already committed the month grid to ship **"with `+N more`
overflow … bounded by its orientation-only role."** The implementation
(`site/calendar.js`, `renderMonth`) instead renders **every entry in full with no
collapse**, citing #5 — a deviation from its own ADR. This round **restores
ADR-0009's intent and refines it**:

- Month is **fixed to one screen**; chips are **one line and capped per day**; the
  overflow past the cap collapses to a **`+N more`** control.
- `+N more` **drills through to that day in Agenda**. ADR-0009 endorsed the overflow
  but never named a target; this round settles the target as the **reading surface**,
  so the control is a hand-off, not a dead end.

This does not re-trigger #5's objection. #5 disqualified `+N more` as a **dead-end
hiding popover** on a grid asked to *read* magnitude. Month remains the **navigator**
(ADR-0009 §2), the density-inversion stays mitigated structurally by Date-spine and
Agenda (ADR-0009 §5), and the overflow now lands the reader on a reading surface
rather than hiding entries behind a count.

**Implementation debt:** `site/calendar.js`'s "No overflow collapse … `+N more` … is
the density inversion #5 disqualified" block (`renderMonth`) must be rewritten to the
capped-plus-`+N more`-to-Agenda behaviour. Recorded here; **no code is changed by
this ADR.**

### 2. Per-source freshness disclosure is demoted to the footer — "disclosed, not surfaced"

#40 required the per-source last-confirmed line to be **"always visible, healthy or
not."** This round narrows *always visible* to **disclosed, not surfaced**: the line
stays present on the page and client-computed — satisfying #40's load-bearing
rationale, that a frozen page still renders a visibly growing lag — but it moves **out
of prime, above-the-fold real estate into the methodology footer**. It is disclosed
to any reader who looks; it no longer competes with the calendar for first attention.

Nothing about #40's mechanism changes: the instant is still baked machine-readable
and the elapsed text still computed at page load. Only its visual prominence is
reduced. (This line is the per-source `lastConfirmed` the glossary flags as a
**Source-health** signal, not the `generatedAt` freshness measure — see CONTEXT.md
§Freshness; demoting it changes presentation, not that taxonomy.)

### 3. The "Singapore time" caption moves below the fold into the methodology notes

The **"Days shown in Singapore time"** caption, previously placed **above the fold**
as a deliberate grid caption, moves to the **last line of the methodology notes**. It
is a methodology footnote, not a control, and no longer earns above-the-fold
placement.

**Honest cost, recorded:** a reader who never scrolls no longer sees the timezone
note. Accepted: the calendar renders in SGT regardless (Asia/Singapore is a fixed
+08:00 with no DST — CONTEXT.md), the times are correct for the Singapore audience the
product serves, and the note remains for anyone who reads the methodology.

## Consequences

- The three existing artifacts these decisions touch are now reconciled in writing:
  ADR-0009 carries a cross-referencing **Amendment 1**; `site/calendar.js`'s month
  comment is flagged above as an **implementation debt** (code untouched here); and
  #40 — closed — has its "always visible" criterion narrowed on record here.
- This ADR is **scoped to the three reversals only.** The remaining round-1 items (the
  double-click event-detail bubble, the today disc, weekend wash, the week grid, the
  date-spine week lines, the ICS-subscription block, the Agenda day-stepping nav, …)
  are net-new and will be captured by the **implementation spec**, not here.
- Like ADR-0009, the decisions are sourced from a **throwaway prototype that never
  merges**; production `site/` implements them fresh.

## Alternatives rejected

- **Amend ADR-0009 in place for all three.** Only the `+N more` item is squarely
  ADR-0009's subject; the freshness placement and the timezone caption are not. A
  single new ADR keeps the round's presentation reversals discoverable in one place,
  with a targeted amendment on ADR-0009 for the one item that is its own.
- **Defer all three to the implementation spec.** Rejected: they *contradict
  decisions already written down.* Leaving that unreconciled until the spec risks the
  built product silently disagreeing with an Accepted ADR, a closed issue's acceptance
  criteria, and a load-bearing code comment.
