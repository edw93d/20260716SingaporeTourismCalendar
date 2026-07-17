# ADR-0009: Web calendar — four switchable views, month-view default

- **Status:** Accepted
- **Date:** 2026-07-17
- **Ticket:** [#12](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/12)
- **Primary source:** prototype on branch
  [`prototype/calendar-ui-12`](https://github.com/edw93d/20260716SingaporeTourismCalendar/tree/prototype/calendar-ui-12/prototype/calendar-ui) —
  four views over one deliberately adversarial dataset. Throwaway; not merged to `main`.

## Context

Two prior findings framed this:

- **#5 (UI reference research)** concluded the **month grid cannot be the reading
  surface.** It *inverts density*: a count-based grid renders five trivial marks on
  one day as busier than a single 40,000-delegate congress on another, and it hides
  overflow behind a `+N more` popover — disqualifying for a product whose job is "how
  much demand lands here", and worse given accepted duplicates (ADR-0004) inflate the
  count. #5's survivable role for the grid was **navigator only**: an overview you
  drill *from* into a date-spine timeline, which it endorsed as the reading surface.
- **#11 (ADR-0008)** killed the firehose iCal feed on the promise that *"if you want
  everything, use the web calendar"* — making the web calendar's whole-picture view
  **load-bearing**, and requiring it to carry the full dataset plus a type filter.

The prototype (#12) built views over one hand-made adversarial dataset — a 5-day /
40k-delegate congress spanning a week, versus a Friday piled with five trivial
entries, plus a ~4,000-passenger cruise call rendered identically to a coffee popup —
to test **which view survives**, and the load-bearing question: **can a type filter
alone carry the load that impact-scoring carries in comparable products (PredictHQ,
Lighthouse), given magnitude is out of scope?**

The prototype ran through several iterations with the product owner, and the answer to
"which single view survives" turned out to be **"none — offer several."**

## Decision

### 1. Four switchable views, not one primary

The web calendar ships **four user-switchable views**. No single view is the "reading
surface"; each answers a different question, and switching between them to read demand
from multiple perspectives is a **first-class feature**, not a fallback:

| Order | View | Question it answers | Role |
|---|---|---|---|
| 1 | **Month** | which days have demand? | **default landing / navigator** |
| 2 | **Week** | what's the shape of this week, hour by hour? | reading surface |
| 3 | **Agenda** | what exactly, and where? | reading surface |
| 4 | **Date-spine** | how long / how much does each thing occupy? | reading surface |

This *is* the answer to "which primary view survives contact with the data": **none
alone — the set does.**

### 2. Default landing is Month — as navigator, not reading surface

The month grid is the universally recognized calendar entry point, so v1 lands there.
On landing its job is **orientation** ("which days are live"), not magnitude. This
keeps #5 intact rather than overturning it: the grid is the **navigator** #5 endorsed,
never the reading surface it disqualified. The moment a reader needs "how much", they
switch to one of the other three.

### 3. Week and Date-spine make time and duration legible; Agenda names everything

- **Week** (macOS-style: days across X, time down Y) shows a week hour-by-hour;
  overlapping events split a day's column, and multi-day events ride an all-day band.
- **Date-spine** (vertical, one row per date) makes **duration literal**: a 5-day
  congress is a physically dominant band, a 3-hour fair a sliver — so **span stands in
  for the magnitude the data does not carry.**
- **Agenda** names every entry and **repeats a multi-day event under each day it
  spans** (a multi-day event is demand on every one of its days).

### 4. Type filter across all views

A single control — **All / VenueEvent / PortCall** — filters every view. It is the
interactive counterpart to #11's two baked feeds, and free: the full dataset is
already in the static page, filtered client-side. This satisfies #11's requirement
that the web calendar carry the everything-view plus a type filter.

### 5. Magnitude stays out of scope for v1

The density-inversion #5 warned about is real, but it is **mitigated structurally, not
by scoring** — the reader can always switch to Date-spine (span) or Agenda (names). No
impact-score, no attendance/pax field, is introduced. This upholds the standing
"magnitude & attendance sizing — out of scope" ruling.

## Consequences

- **The inversion is mitigated, not eliminated — and the two default-adjacent views
  are the inversion-prone ones.** Month (the default) and Week both encode "busy" as
  count / spatial fill, so a glance at either can misread which day is busiest.
  Accepted because Month's framed job is orientation and the corrective views
  (Date-spine, Agenda) are one toggle away.
- **One honest hole, recorded: cruise calls.** A ~4,000-passenger ship is an ~11-hour
  call with **no long span and no descriptive name**, so in *every* view it renders
  identically to a coffee popup. No view or filter fixes this without a magnitude
  field. Accepted for v1: the audience infers ship size from the **vessel name**.
  **Trigger to reopen:** if real use shows this cruise-magnitude blindness actually
  misleads, magnitude re-enters scope — as a **destination redraw**, the path #12
  always reserved, not a quiet patch.
- **Everything stays static-renderable, honouring #10 and #11's binding.** All four
  views, the filter, week paging, and the Today control are client-side JS over the
  full dataset already on the page — no server-side logic, no per-request compute.
  Pages serves it serverless, and the web calendar delivers the everything-view #11
  depends on.
- **Four views is more build surface than one.** v1 commits to building the month
  grid (with `+N more` overflow and inversion understood and accepted, bounded by its
  orientation-only role), a week grid with overlap-splitting, an agenda, and a
  date-spine — plus a shared filter and Today control. Accepted deliberately: the
  multi-perspective read is the feature.
- **Component/library choice is not decided here.** The prototype is hand-rolled
  (vanilla, no framework) precisely so it answers the *shape* question without
  prejudging the stack. Which UI library (if any) implements these views remains
  **gated by the licensing decision (#14)**, not by this ADR.

## Alternatives rejected

- **A single primary view (Date-spine only)** — #5's literal recommendation, and
  cleaner. Rejected because the views genuinely answer different questions and the
  value is in cross-referencing them; a lone timeline loses the month-at-a-glance
  orientation professionals expect from a calendar.
- **Month grid as the default *reading* surface** — would overturn #5. Rejected: the
  grid inverts density and hides overflow. Fine to *land* on for orientation; wrong to
  *read magnitude* from.
- **Impact-scoring / a magnitude field in v1** — the honest fix for the inversion in
  the abstract, and what the comparable products do. Rejected for v1: the sources do
  not publish attendance or passenger counts, the manual Excel never carried it, and
  inventing it is unsupported by fact and beyond the destination. Deferred with an
  explicit reopen trigger (see Consequences).
