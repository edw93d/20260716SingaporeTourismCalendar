# Research index

Every research document in this repository, and whether you can trust it.

**Nothing here is deleted or rewritten when it goes stale.** The house style is to supersede in
place and say so at the top of the file — see
[`v2-source-acquisition.md`](v2-source-acquisition.md) §3, which leaves a wrong method note standing
with the correcting rule beneath it, and [ADR-0021](../adr/0021-reading-sources-that-forbid-it.md),
which keeps its rejected alternative struck through because "the mistake is the useful part". A
superseded document still records **what was read on the day it was read**, which is the only thing
that can answer "what did we know, and when".

**So: read the banner, not the title.** Every file below opens with a ⚠️ or ✅ line saying where it
stands. This table is the summary; the banner carries the detail.

---

| Document | Ticket | Read on | What it covers | Superseded by | Live? |
|---|---|---|---|---|---|
| [`v2-source-acquisition.md`](v2-source-acquisition.md) | [#113](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/113) | 04 Aug 2026 | The route in for each of 21 v2 sources — API, feed, scrape, browser or none — with ToS, rendering, anti-bot, volume and horizon per source | — *(§*Method* amended in place 05 Aug 2026 by ADR-0021: probe honest-first, never with a browser User-Agent)* | ✅ **Current** |
| [`sistic-capability-legal-audit.md`](sistic-capability-legal-audit.md) | [#131](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/131) | 05 Aug 2026 | SISTIC end to end — the one genuinely unauthenticated JSON API on the list, 284 discrete events, 88% unique to it | — | ✅ **Current** |
| [`aggregator-overlap.md`](aggregator-overlap.md) | [#115](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/115) | 05 Aug 2026 | How much EventsEye, bigevent.io and TTGmice duplicate each other — 5 cross-source duplicates in 194 rows, and the three larger findings underneath: next-edition rows, co-location, and why title similarity has no clean threshold | — | ✅ **Current** — the evidence behind [ADR-0023](../adr/0023-the-matching-rule-joins-are-proposed-and-permanent.md); ⚠️ every threshold is calibrated to one corpus and one similarity function, see §9 |
| [`changi-arrivals.md`](changi-arrivals.md) | [#25](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/25) | 04 Aug 2026 | The Changi AppSync GraphQL endpoint, its 363-day forward horizon and ~72-hour backward leash, ~497 arrivals/day, and three silent correctness traps | — *(§7's legal reading is now carried, with a verdict, in [`source-register.md`](../source-register.md))* | ✅ **Current** — [#126](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/126) builds from it |
| [`output-format-constraints.md`](output-format-constraints.md) | [#6](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/6) | 16 Jul 2026 | What RFC 5545 permits vs what Google, Apple and Outlook actually keep; UID stability; the reduced-projection position | — *(two recommendations overturned by decision: inclusive end dates by [ADR-0003](../adr/0003-store-utc-instants.md); `SEQUENCE` serialization by [ADR-0008](../adr/0008-ical-feed-shape-two-type-split-feeds.md) §5)* | ✅ **Current as research** — check §4, §8.4 and §10 against the banner |
| [`calendar-ui-templates.md`](calendar-ui-templates.md) | [#5](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/5) | 16 Jul 2026 | Why a month grid cannot be the reading surface for this dataset; reference products; a priced component shortlist | — *(Part 3's licensing fork was answered by hand-rolling the UI; prices unmaintained)* | ✅ **Current** as the record behind [ADR-0009](../adr/0009-web-calendar-four-switchable-views.md) / [ADR-0014](../adr/0014-web-calendar-presentation-refinements-uiux-round-1.md) |
| [`source-capability-audit.md`](source-capability-audit.md) | [#2](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/2) | 16 Jul 2026 | What the four seed sources expose — API, structured data, rendering, anti-bot, and whether end times exist | [`v2-source-acquisition.md`](v2-source-acquisition.md), 04 Aug 2026 — **as a source survey only** | ⚠️ **Partly.** Still the only record of the field-level parsing for the three production v1 adapters |
| [`source-landscape.md`](source-landscape.md) | [#4](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/4) | 16 Jul 2026 | What else should feed the calendar — 6 ranked candidates, and the death of STB's TIH | [`v2-source-acquisition.md`](v2-source-acquisition.md) (21 sources), 04 Aug 2026; its SISTIC section by [`sistic-capability-legal-audit.md`](sistic-capability-legal-audit.md), 05 Aug 2026 | ⚠️ **Superseded** — the TIH evidence still stands |
| [`legal-tos-audit.md`](legal-tos-audit.md) | [#3](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/3) | 16 Jul 2026 | Whether the four seed sources may be scraped and republished — clause by clause, plus the Singapore copyright position | [ADR-0021](../adr/0021-reading-sources-that-forbid-it.md) and [`source-register.md`](../source-register.md), 05 Aug 2026 | ⚠️ **Superseded** |

---

## Two things this table exists to stop you believing

**1. "Superseded" does not mean "was wrong".** Six of the eight documents above were superseded by a
*wider* survey, not a correcting one. `legal-tos-audit.md` is the sharpest case: ADR-0021's *Context*
describes v1's audit as having "checked `robots.txt` and stopped there", and that is not what the
document does — it quotes all four sources' terms verbatim and flags by name two clauses the register
now carries as operative. What actually happened is the other half of the register's sentence: it
**left no record**, because its branch sat unmerged for three weeks. #113 then re-derived SCC's
"internal" clause on 04 Aug and marked it **new**, because as far as `main` was concerned it was.

That is the failure this index is here to prevent, and it cost a re-audit.

**2. The legal position moved further than any single document.** No research file here is the
authority on whether a source may be read. [ADR-0021](../adr/0021-reading-sources-that-forbid-it.md)
is the rule and [`docs/source-register.md`](../source-register.md) is the per-source record, and both
postdate every audit above. Where a research doc states a legal verdict, the register overrides it.

## When you add a research doc

1. Open it with a `✅ Current` banner on the first line.
2. Add a row here.
3. When something later supersedes it, change the banner to `⚠️ Superseded by <doc/ADR> on <date> —
   kept for the record, because it records what was read on <date>`, update this table, and **change
   nothing else in the file**.

There is a third form, and it is not a hedge. **`⚠️ Superseded in part` is correct whenever a flat
⚠️ would point someone away from the only record of something.** Use it when a wider document
replaced this one's *conclusions* but never re-derived some part of its *detail* — and when you do,
say in the banner exactly which sections still stand and why, so the reader knows what to trust
without reading both documents.

[`source-capability-audit.md`](source-capability-audit.md) is the worked example. #113 superseded it
as a source survey, but never re-derived which bytes to parse for `suntec`, `mbccs` and `scc` — the
three adapters in production. A flat ⚠️ would have retired the only record of how they read their
sources.

**Do not reach for it to avoid a judgement call.** If a document is wholly superseded, say so; the
whole point of keeping it is that being wrong on the record is useful.
