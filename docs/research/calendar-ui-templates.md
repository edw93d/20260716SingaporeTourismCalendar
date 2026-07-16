# Reference templates: professional, data-dense calendar UI

Research for [#5](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/5). Feeds the prototype ticket ([#12](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/12)).

**Question.** What are the good reference examples for a professional, data-dense calendar aimed at industry users, and what makes them work?

This document is references and principles to react to, not a recommendation. Where the evidence points somewhere, it says so and shows the source. Where a claim could not be verified against a primary source, it is marked **[unverified]**.

---

## TL;DR

Three findings, in order of how much they should change the design:

1. **The professional demand tools in this exact domain do not make a month grid their primary surface.** Lighthouse (hotel revenue management) leads with a "Market outlook" — a date-spine bar chart — and offers Calendar, Graph and Table as *alternate* dashboards. Events appear as a *demand-driver layer* on a date spine, not as first-class blocks.
2. **Every component vendor sells the timeline as the premium tier.** FullCalendar, DHTMLX, Schedule-X and Mobiscroll all ship month/week/day free-or-cheap, and gate timeline/resource views behind the paid tier. Vendors charge for the view professionals actually need. That is a market signal about which view is load-bearing.
3. **The month grid's failure mode on this dataset is documented by its own vendors.** FullCalendar's `dayMaxEvents` exists precisely because day cells overflow; the overflow resolves to a `+more` link and a popover — i.e. *the grid's answer to density is to hide the data behind a click*. On a dataset whose whole point is "how much demand lands on this date", hiding the density is hiding the product.

**My read on the crux:** a month grid can survive as a *density overview* — where each cell's job is to answer "how loaded is this day" via a count/heat treatment rather than to render individual events — but it cannot be the surface where a user reads the events themselves. See [The crux](#the-crux-can-a-month-grid-survive-this-dataset).

---

## Part 1 — Real products whose primary surface is a dense professional calendar

Deliberately excludes consumer "what's on" listings.

### 1.1 Lighthouse (formerly OTA Insight) — hotel revenue management

The closest commercial analog to this project's audience: software for hotel revenue managers who plan around demand landing.

- Product: [Market Insight](https://www.mylighthouse.com/platform/market-insight), [Rate Insight](https://www.mylighthouse.com/platform/rate-insight)
- Primary write-up: [How Hotel Revenue Managers Win with Lighthouse Market Insight](https://www.mylighthouse.com/resources/blog/how-to-get-the-most-out-of-lighthouse-market-insight)

**What it does.** The primary view is a **"Market outlook"** which displays "all days from a demand *and* price perspective" — demand rendered as **blue bars**, opportunity dates flagged with **circular icons**, price alongside. Selecting a single date drills into a detail dashboard with a **demand evolution heatmap**. The platform offers **Calendar, Graph and Table views** as alternate dashboards ([source](https://www.mylighthouse.com/platform/rate-insight)).

**How events are handled.** Events are imported into the dashboard and viewable **up to 365 days in advance**, and are surfaced **inside the rate shop calendar** so the user gets "a complete picture of demand drivers on any given date" ([source](https://www.mylighthouse.com/resources/blog/how-to-get-most-out-of-lighthouse-rate-insight)).

**Why it matters here.** This is the single most transferable reference. Note what it implies:

- The date spine is the primary axis; the **day is the unit of analysis**, not the event.
- Events are an **annotation layer on dates**, not objects the user browses.
- The primary view is **not a month grid** — it is a horizontal bar chart over dates.
- Calendar is offered as *one of three* views, not as the product.

**Critique against this dataset.** Lighthouse's model works because it has a magnitude to plot (demand level, price). **This project's standing constraint is existence + timing only, no magnitude sizing** (map #1, Notes). So the blue-bar demand chart is *not directly copyable* — there is no demand number to plot. The transferable part is the *structure* (date spine primary, events as annotation, day as unit), and the honest substitute for magnitude is **count and category mix per day**, which is derivable from existence alone.

### 1.2 PredictHQ — event demand intelligence

Literally this dataset's commercial cousin: aggregated event data sold to hotels and travel platforms for demand planning.

- [Events API for Hotel Revenue Management](https://www.predicthq.com/events/hotel-revenue-management)
- [Demand Intelligence API](https://www.predicthq.com/apis/event-api)

**What it does.** Enriches events with **predicted attendance, event spend, rankings, impact scores and polygons** to quantify impact; the WebApp lets users "search for events and easily visualize demand fluctuations"; hotel-facing integrations show events on a **map view illustrating each event's impact by volume**.

**Critique against this dataset.** PredictHQ's entire UI thesis is **rank/impact scoring** — it sorts and sizes events by predicted attendance so the user can ignore most of them. **That is explicitly out of scope here** ("Magnitude & attendance sizing — the sources do not publish it, and the manual Excel has never carried it", map #1, Out of scope). This is a useful *negative* reference: it shows the industry-standard answer to category density is *ranking*, and this project has deliberately foreclosed that answer. **Without a ranking signal, the UI must let the user do the filtering that PredictHQ does with a score** — which raises the importance of category/source facets and makes "show everything, densely" the fallback.

> **Design tension worth raising with the user.** PredictHQ and Lighthouse both solve density by *scoring*. v1 has ruled scoring out. The load-bearing question for the prototype is therefore: *what does the user filter on instead?* Category, source, venue and duration are the only axes the dataset carries.

### 1.3 The domain's own professional sources present this data as **tables**, not calendars

Worth noting because it is the incumbent this product replaces.

- **Marina Bay Cruise Centre Singapore** — [Cruise Schedule](https://mbccs.com.sg/cruise-information?tab=cruise-schedule). Verified 2026-07-16: presented as a **table**, columns **Vessel | Pier Number | Arrival | Departure**, filtered to a short rolling date window (the live page showed `16 Jul 2026 (Today) – 20 Jul 2026`). Not a calendar.
- The user's own current workflow is **Excel** (map #1, Notes) — i.e. a table.

**Critique.** The audience's existing mental model for port calls is *a table with arrival and departure columns*. A 12-hour port call is a **row with two times**, not a block on a grid. This is evidence that an **agenda/table view is not a downgrade for this audience — it is their native format**, and it handles the wildly-varying-duration problem for free (duration is just two columns). The product's value-add over the table is *aggregation across sources* and *seeing collision*, not the grid itself.

### 1.4 Broadcast programming / traffic scheduling

Investigated as instructed (deliberately outside consumer listings). Products: [Myers ProTrack](https://myersinfosys.com/protrack-tv/), WideOrbit.

**Finding: weak reference, low confidence.** ProTrack's marketing describes "streamlined **Scheduling Grid** screens" and a Log Manager, and it "integrates with systems up and down the broadcast chain". But these are **enterprise products with no public demo and no published UI documentation** — I could not reach a primary source showing the actual interface. **[unverified]** — I am not going to characterise a UI I could not see. Flagging it as a dead end rather than padding the shortlist with a guess.

The structural point that *does* survive: broadcast scheduling is a **resource-timeline** problem (channel × time), which is the same shape as venue × time. That shape is covered better by the component evidence in Part 3.

---

## Part 2 — The crux: can a month grid survive this dataset?

The ticket names this as the crux, and the evidence is fairly one-directional.

### The dataset's shape

From map #1: MICE congresses (multi-day, ~3–5 days), ticketed events (3-hour concerts), cruise port calls (~12 hours, arrival + departure same day). Plus: **duplicates are accepted and labelled by source in v1** — so the same congress may appear 2–3 times from different scrapers. **This actively inflates density.** The grid must render not just N events but N×(sources carrying it).

### What the grid vendors themselves say

FullCalendar's [`dayMaxEvents`](https://fullcalendar.io/docs/dayMaxEvents) docs, quoted:

> "In **dayGrid** view, the max number of events within a given day, not counting the +more link. The rest will show up in a popover."

Set to `true`, it "automatically limits events based on the actual height of the day cell". So the month grid's official answer to overflow is: **render as many as fit, hide the rest behind `+more`, reveal on click.**

This is disqualifying for the primary view of *this* product. The user's job-to-be-done is "how much demand lands on this date, and what kind". A view that silently truncates to what fits in ~80px of cell height, on a dataset that intentionally contains duplicates, is answering the wrong question — and answering it unreliably, because *which* events get hidden depends on cell height.

### The multi-day span problem

Month grids render a multi-day event as a horizontal bar spanning cells, which forces every other event in those cells downward. A single 5-day congress consumes a row of vertical space across five cells; three overlapping congresses consume three rows across the whole week — before a single concert or port call is drawn. This is the classic month-grid pathology and it is precisely this dataset's dominant case. **The dataset is mostly multi-day spans, and multi-day spans are what the month grid handles worst.**

### The convergent market signal

Every vendor gates the timeline behind the paid tier:

| Vendor | Free / base | Timeline or resource view |
|---|---|---|
| FullCalendar | MIT core (month/week/day/list) | **Premium only** ([docs](https://fullcalendar.io/docs/timeline-view), [license](https://fullcalendar.io/license)) |
| DHTMLX Scheduler | Standard (day/week/month/year/agenda) | **PRO only** — Timeline, Units, Grid ([docs](https://docs.dhtmlx.com/scheduler/)) |
| Schedule-X | MIT (month grid, week, day, month agenda) | **Premium only** — Resource scheduler, Time grid resource view ([docs](https://schedule-x.dev/docs/calendar)) |
| Mobiscroll | Lite (Apache-2.0) | Timeline in paid ([demos](https://demo.mobiscroll.com/eventcalendar)) |

Four independent vendors, same commercial boundary. The month grid is the commodity; **the timeline is what professionals pay for.** That is about as clear a market signal as this kind of research produces.

### Verdict

**A month grid cannot be the reading surface for this dataset.** It can survive in one specific role: as a **density overview / navigator**, where the cell's job is to answer *"how loaded is this day, and with what mix"* — a count, a category-coloured heat treatment, a stack of category dots — and **clicking a day drills into an agenda or timeline that actually shows the events.** In that role the grid's weakness (can't show many events) is irrelevant, because it isn't trying to.

This maps almost exactly onto Lighthouse's structure: **outlook (density over a date spine) → select a date → detail dashboard.** The reference product and the component evidence agree.

**The strongest candidate primary view for this dataset**, on the evidence: a **horizontal timeline over a date axis** (each event a bar, duration = bar length — which solves the 3-hour-vs-5-day problem natively, since duration becomes *visually literal*), optionally with **rows grouped by category or venue** (the "resource" axis), plus an **agenda/table view** as a first-class peer for the port-call/Excel mental model (§1.3), and a **month grid as a density navigator**, not a reader.

---

## Part 3 — Component & template shortlist

Verified against vendor primary sources on 2026-07-16. **Prices are as published and exclude VAT/renewal terms; confirm before relying on them.**

### 3.1 FullCalendar

- Links: [site](https://fullcalendar.io/), [license](https://fullcalendar.io/license), [pricing](https://fullcalendar.io/pricing), [timeline docs](https://fullcalendar.io/docs/timeline-view)
- Repo: [fullcalendar/fullcalendar](https://github.com/fullcalendar/fullcalendar) — **MIT**, ~20.5k stars, last push 2026-06-19 (actively maintained).

**Licensing — the important detail.** The non-premium plugins and the `fullcalendar` bundle are **MIT**. **FullCalendar Premium** (`fullcalendar-scheduler`) is **tri-licensed** and this matters for this project:

- **Commercial** — for-profit use. **From $480/developer**, 1 year of upgrades/support; renew before expiry for 50% off base, after expiry 25% off.
- **Non-commercial** — registered nonprofits, free, via key `'CC-Attribution-NonCommercial-NoDerivatives'`.
- **AGPLv3** — free premium if your project is **fully AGPLv3 on frontend *and* backend**, via key `'AGPL-My-Frontend-And-Backend-Are-Open-Source'`.

**Critique.** Timeline view — the view this dataset most likely needs — is **premium only**. So the real question FullCalendar poses is a **licensing decision, not a technical one**: this is a public v1 (map #1, Destination). If the project is willing to be **AGPLv3 across the whole stack**, premium timeline is **free**. If not, it's $480/dev/year, recurring. That's a genuine fork in the road and it should go to the user, not be decided in a research doc.
**What it forecloses:** nothing technically — it's the most capable and best-documented option, with month, timeline, resource-timeline and list views. It forecloses *licence-freedom* unless you go AGPL.

### 3.2 Schedule-X

- Links: [site](https://schedule-x.dev/), [calendar docs](https://schedule-x.dev/docs/calendar), [premium](https://schedule-x.dev/premium)
- Repo: [schedule-x/schedule-x](https://github.com/schedule-x/schedule-x) — **MIT**, ~2.5k stars, last push 2026-07-15 (**very actively maintained**).

**Views.** Free/MIT: **month grid, week, day, month agenda**. Premium (⭐): **Resource scheduler, Time grid resource view**, drag/drop, resize, event modal, sidebar, drag-to-create, draw, scheduling assistant.

**Pricing.** **€479/year** (2–3 devs) or **€999 lifetime** one-time (2–3 devs, incl. 1yr support); Enterprise custom. Licensed **per project**, where a project = a product (a SaaS with many customers = 1 project). Restriction: can't resell the premium source as your own product.

**Critique.** Self-describes as a "modern alternative to fullcalendar and react-big-calendar". The **MIT tier has no timeline** — and critically, its free views are exactly the ones this dataset handles worst (month grid, week, day). **The month agenda in the free tier is genuinely useful** for the §1.3 table mental model. Per-project lifetime licensing at €999 is cheaper than FullCalendar's per-dev-per-year if the team grows; more expensive if it's one dev shipping once.
**What it forecloses:** smaller ecosystem than FullCalendar (2.5k vs 20.5k stars) — fewer worked examples, more time in the docs. Its "Resource scheduler" is resource-oriented; **[unverified]** whether it renders a long multi-week date axis as cleanly as FullCalendar's `timelineMonth`/`timelineYear` — this is the exact capability this dataset needs and it should be prototyped before committing.

### 3.3 DHTMLX Scheduler

- Links: [docs](https://docs.dhtmlx.com/scheduler/)

**Views.** Standard: day, week, month, year, agenda. **PRO: Timeline, Units, Week Agenda, Grid.** Standard ships via public npm; PRO via private registry.

**Critique.** Timeline + Units (resource lanes) + Grid is a strong match for the shape this dataset needs, and **Grid** covers the table view natively. **[unverified]** — the docs page references a licensing section but does not state the terms; **DHTMLX Scheduler's standard edition has historically been GPL, which would be a real constraint on a closed-source product** — this needs confirming with the vendor before it's shortlisted seriously.
**What it forecloses:** older/heavier API surface than the modern options; less idiomatic in a React/Tailwind stack.

### 3.4 Mobiscroll

- Links: [event calendar & scheduler](https://mobiscroll.com/event-calendar-scheduler), [pricing](https://mobiscroll.com/pricing), [demos](https://demo.mobiscroll.com/eventcalendar)

**Views.** Four: **Calendar** (week/month/year), **Scheduler** (day/week/work-week, resources), **Timeline** (day/week/month, resources, drag & drop), **Agenda** (daily/monthly/yearly event list). Agenda can be **combined with calendar views** — directly relevant to the grid-as-navigator pattern.

**Licensing.** **Mobiscroll Lite is Apache-2.0**; Pro is commercial. Timeline sits in the paid "Scheduling & calendaring" or "Complete" licences. Internal-project licences include first year of maintenance, renewable yearly. 30-day refund. **[unverified]** — published per-seat prices were not confirmed from the pricing page in this pass; a third-party source claimed mid-five to low-six figures for *enterprise embedding* deals, which is not the relevant tier here and should be ignored rather than quoted.

**Critique.** The **timeline + agenda combination is the best out-of-the-box fit** for the structure Part 2 lands on. Mobiscroll is strongly mobile-oriented, which is arguably right for the audience (a hotelier checking next week's demand on a phone) — but the "Bloomberg terminal energy" the user asked for is a *desktop-density* aesthetic, and Mobiscroll's design language is friendly/mobile-first, not dense/professional.
**What it forecloses:** the visual register. You'd be fighting its default look to get to terminal density.

### 3.5 Bryntum

- Links: [Calendar](https://bryntum.com/products/calendar/), [store/pricing](https://bryntum.com/store/)

**Products & pricing (from $, per published store page).** Scheduler **from $680**; **Scheduler Pro from $1,100**; Calendar **from $680**; Gantt **from $940**; Complete Bundle **from $3,790**. No free/OSS tier found. **[unverified]** — perpetual vs subscription terms not stated on the store page.

**Critique — important distinction.** **Bryntum *Calendar* is not the timeline product.** Its views are day/week/month/year/agenda, day-agenda, grid, dual-day — the docs for the Calendar product describe **no timeline/resource/Gantt view**. The timeline capability lives in **Bryntum Scheduler / Scheduler Pro**, a separate purchase. So "use Bryntum" for this dataset likely means **Scheduler ($680+), not Calendar** — and possibly both, i.e. bundle territory.
**What it forecloses:** cost, and no OSS escape hatch. It is the highest-end option; Bryntum's pitch is "fast performance, even with massive data sets", which is real, but this dataset is *hundreds* of events, not hundreds of thousands. **Buying Bryntum for this dataset is buying scale the project does not have.**

### 3.6 Toast UI Calendar

- Repo: [nhn/tui.calendar](https://github.com/nhn/tui.calendar) — **MIT**, ~12.7k stars.

**Critique — maintenance risk, verified.** **Last push 2024-06-24** — over two years stale as of 2026-07-16, despite not being marked archived. Popular and MIT, with month/week/day views, but **adopting a two-year-dormant calendar library for a product that must run daily with breakage detection (map #1, Destination) is taking on a dependency the vendor appears to have stopped maintaining.** Recommend excluding unless someone can show recent activity on a branch.

### 3.7 Tailwind Plus (formerly Tailwind UI)

- Links: [Calendars UI blocks](https://tailwindcss.com/plus/ui-blocks/application-ui/data-display/calendars), [license](https://tailwindcss.com/plus/license)

**Licensing.** One-time purchase, no subscription; gets you every component package and site template, present and future. Permits unlimited projects including paid SaaS. **Forbids** building website builders / themes / UI kits — i.e. anything repackaging the components for others to build with. Not a concern for this project.

**Critique.** **[unverified]** — the component detail is behind the paywall and I could not enumerate the exact examples or confirm whether they're static markup only. What is safe to say: **Tailwind Plus sells *markup*, not calendar logic.** There is no event engine, no overlap resolution, no timeline layout algorithm — the hard parts of this dataset (stacking overlapping multi-day spans without collisions) are exactly what it does not solve.
**What it forecloses:** nothing — it composes fine with anything. But it is **not an answer to this ticket**; it's an answer to "what should it look like", not "how do we lay out 40 overlapping spans". Treat as a styling layer over a real calendar engine, or over a hand-rolled timeline.

### 3.8 shadcn/ui

- Links: [Calendar component](https://ui.shadcn.com/docs/components/calendar)

**Critical clarification.** shadcn/ui's `Calendar` is **a date picker, not an event calendar.** It is "a calendar component that allows users to select a date or a range of dates", **built on React DayPicker**. The docs describe single-date and range selection, month/year dropdown navigation, and timezone awareness. There is **no support for events, multi-day event spans, or timeline views**.

**Critique.** This is the most likely source of a wrong turn on this ticket, because "shadcn has a Calendar" is true and irrelevant. It **cannot render this dataset at all** without building the entire event layer by hand.
**What it forecloses:** everything, if mistaken for an event calendar. **What it's actually good for:** the date-range filter control *around* the real calendar — which this product will need — and, as a design system, the dense/neutral visual register the user asked for. Use it for chrome, not for the calendar.

---

## Part 4 — Principles to react to

Drawn from the references above, each traceable to a source in Parts 1–3. These are for the user to agree or disagree with, not conclusions.

1. **The day is the unit of analysis, not the event.** Lighthouse's outlook, and the audience's job ("how much demand lands on this date"), both point this way. Consumer listings put the event first; demand tools put the date first. (§1.1)
2. **Duration should be visually literal.** A 3-hour concert and a 5-day congress differ by ~40×. Only a timeline encodes that difference honestly — a month grid renders both as "a thing in a cell". (§2)
3. **Density must be shown, not hidden.** `+more` popovers are the grid's answer and they're the wrong answer here, especially given v1 accepts duplicates that inflate density. (§2)
4. **Filtering replaces ranking.** The industry solves density by scoring (PredictHQ); v1 has ruled scoring out; therefore category/source/venue facets carry that entire load. (§1.2)
5. **The table is not a downgrade.** Port calls are natively a table (Vessel | Arrival | Departure), and the user's incumbent is Excel. An agenda/table view is a first-class peer, not a fallback. (§1.3)
6. **The month grid earns its place as a navigator, not a reader.** Density overview → drill to a date → read in agenda/timeline. This is Lighthouse's structure. (§2)
7. **Professional ≠ decorated.** The user asked for "Bloomberg terminal energy". Every reference here is information-dense, low-chrome, table-adjacent, and monochrome-plus-accent. None of them are pretty in the Eventbrite sense.

---

## Open questions for the user

1. **Licensing fork (the big one).** Is this v1 willing to be **AGPLv3 across frontend and backend**? If yes, FullCalendar Premium's timeline is **free** and FullCalendar is the obvious pick. If no, timeline costs €479–$480+/yr recurring (Schedule-X / FullCalendar) or €999 once (Schedule-X lifetime). This decision gates the component choice more than any technical factor. (§3.1, §3.2)
2. **Does the density overview need a magnitude?** "Existence + timing only" means the honest per-day signal is a **count and category mix**. Is a count enough to be useful, or does the absence of magnitude make a density view misleading (5 minor events looking "busier" than one 40k-delegate congress)? This is the sharpest tension between the map's constraints and the reference products. (§1.2)
3. **Is the resource axis category, or venue?** Timeline rows have to be *something*. Venue matters for the audience (a Suntec congress means something different to a Marina Bay hotelier than to one in Sentosa), but venue cardinality may be too high for clean lanes. (§2)

## Not investigated / limitations

- **Broadcast & airline scheduling UIs** — no public demos or UI documentation reachable; characterised as a dead end rather than guessed at. (§1.4)
- **Screenshots** — not captured. The reference products (Lighthouse, PredictHQ) are behind sales demos/logins, and Tailwind Plus components are paywalled. Links are given instead; **a live walkthrough of a Lighthouse demo would be the single highest-value follow-up** if access is obtainable.
- **DHTMLX licence terms** and **Mobiscroll per-seat pricing** — not confirmed from primary sources. (§3.3, §3.4)
- **Schedule-X resource view over a long date axis** — capability unconfirmed; prototype before committing. (§3.2)

---

*Verified 2026-07-16. Prices and licence terms change; re-check before relying on them.*
