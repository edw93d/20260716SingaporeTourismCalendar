# ADR-0020: Second-hand sources are admitted; first-hand wins ties

- **Status:** Accepted
- **Date:** 2026-08-05
- **Ticket:** [#128](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/128)
- **Supersedes:** the resolution of [#13](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/13),
  **in part** — its ruling that *"the unit of a source is a venue, not a ticketing platform"*, and
  **only** that ruling. #13's other finding — that v1 needed no ticketed-event coverage — was correct
  for v1 and is not disturbed.
- **Supersedes no ADR.** See *Context*.

## Context

#13 ruled in v1 that a source is a **venue**, and deferred aggregators and ticketing platforms
post-v1. It deferred them on two claims it explicitly did not test:

1. An aggregator carries events at **minor/one-off venues** that would never be scraped directly.
2. An aggregator's site is typically **better-maintained** than an individual venue's.

v2's source list contains seven aggregators and three ticketing platforms, so the ruling had to be
faced. [#112](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/112)'s standing rule
is that v1's rulings bind unless reversed **explicitly, by name, with reasons** — and that these two
claims be **tested, not assumed**.

### Both claims were tested against live data on 05 Aug 2026

EventsEye was fetched across 11 month-pages (Aug 2026 → Jun 2027, **96 rows**) and bigevent.io's
JSON-LD in full (**13 rows**). EventsEye's venue distribution:

| Venue | Rows | Share |
|---|---:|---:|
| Marina Bay Sands | 58 | 60% |
| Singapore EXPO | 17 | 18% |
| Suntec | 12 | 13% |
| Five hotels + F1 Pit Building | 6 | 6% |
| Changi Exhibition Centre | 1 | 1% |
| Unnamed (bare `Singapore`) | 2 | 2% |

bigevent.io: 8 of 13 at MBS/Sands Expo, 1 at Village Hotel Changi, 4 unnamed — **none** at a venue
any adapter covers.

**Claim 1 is true, and small.** Minor and one-off venues are **6%** of what EventsEye carries. The
mechanism #13 named is real but is not the reason worth reversing on.

**Claim 2 is not supported, in either direction.** EventsEye serves no `robots.txt`, 404s on links
its own footer publishes, drifts ±2 rows between fetches, and softens dates with distance (2026:
52 firm / 4 soft; 2027: 28 / 12; 2028: 4 firm of 30 per #113 — one row read literally
`April 2027 (?)`). bigevent.io's terms page is an empty shell and 4 of 13 rows name no venue. But
the venue side is no better: RWS publishes `0001-01-01` null sentinels on 33 of 48 cards, Singapore
EXPO's WordPress API omits dates entirely, The Star gives dates but no times. Meanwhile JustRunLah!
(second-hand) publishes clean flag-off times and bigevent.io publishes structured ISO JSON-LD.
**Maintenance quality varies per site and does not track source type.**

**The duplicate-flood objection is also falsified.** If aggregators merely restated events already
reachable, they would buy duplicates and no coverage. Only **13 of 96 rows (14%)** sit at a venue
reachable today.

### This ADR contradicts nothing in `docs/adr/`

v1's architecture was built expecting this source to arrive:

- **ADR-0001**: *"#13 (ticketed-event coverage) becomes a pure sourcing question"* — `VenueEvent`
  already absorbs it.
- **ADR-0008**: a ticketed source *"folds into an existing type feed and adds no feed"*.
- **ADR-0004**'s opaque `sourceKey` is vindicated by exactly these sources: EventsEye has nothing
  but name + date + venue, and bigevent.io's `url` points at a *third-party* site. #113: *"No
  core-owned key rule could span these."*

#13's ruling lived only as a resolution comment on a closed issue. It was never an ADR, so there is
no ADR to supersede.

## Decision

**v2 admits second-hand sources — aggregators and ticketing platforms — alongside venues.**

Three reasons, and these are the record:

1. **Second-hand sources list events at small venues we may never scrape.** Measured at 6%: five
   hotels and the F1 Pit Building.
2. **Second-hand sources list events further ahead than the venue itself does.** Marina Bay Sands'
   own expo directory is a **rolling 3-day window**; bigevent.io carries MBS events to **08 Sep
   2027** and EventsEye reaches **May 2028**. Roughly 13–18 months of extra lead on the same venue.
3. **Maintenance quality is not a differentiator** — it varies per site on both sides, so it is a
   reason neither for nor against. This is the direct refutation of #13's claim 2.

**One new domain term: `first-hand` / `second-hand`** (see `CONTEXT.md`). A first-hand source
publishes its own events; a second-hand source reports someone else's. It exists to **break ties
when the same event arrives from more than one source**, and does no other work.

**The `Source` contract does not change.** `key`, `fetch`, `parse` are untouched, and `Raw` stays
opaque. Provenance, the admin-facing description, and the default relevance verdict are **source
manifest metadata**, not adapter concerns: `fetch` and `parse` need none of them, while the merge
step, the admin page and the moderation step each need one. Widening the seam every adapter
implements, to serve code that is not the adapter, was rejected.

**Admin-facing descriptions are retained and carry no behaviour**: `event venue`, `event
aggregator`, `ticketing platform`, `cruise terminal`, `airport`.

**Credibility / authority is not modelled.** It was considered — VisitSingapore and STB are
second-hand yet authoritative — and dropped, because the admin reviews entries manually and a
second ranking axis would not change what the code does.

## Consequences

- **Ten sources become admissible** that #13 excluded: EventsEye, bigevent.io, TTGmice, JustRunLah!,
  SportPlus SG, VisitSingapore MICE and STB as aggregators; Eventbrite, Ticketmaster SG and SISTIC
  as ticketing platforms.
- ⚠️ **No ticketing platform is currently usable, and admitting the category does not change that.**
  Eventbrite's ToS §13 bans scraping by name and its public event-search API is gone; Ticketmaster
  SG bans robots and runs a live bot block with no Asian API coverage; **SISTIC has never been
  audited** — #13 deferred that audit and its T&C remain JS-gated and unread
  ([#131](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/131)). This ADR reopens
  a door that permission still holds shut. **Ticketed coverage has not arrived.**
- **The reversal is load-bearing for Marina Bay Sands.** MBS is categorically a venue whose own expo
  directory reaches 3 days. Everything beyond that is second-hand, via bigevent.io, EventsEye and
  TTGmice. Had #13 survived, forward-dated Sands Expo coverage would have been impossible, not
  merely reduced.
- **Duplicates become the central design problem, not an accepted cost.** #113 predicted bigevent.io
  *"will duplicate EventsEye and TTGmice heavily"*. `first-hand`/`second-hand` orders a merge; it
  does **not** decide what to store, and it gives no tiebreak between two second-hand sources.
  Owned by [#129](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/129) and
  [#115](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/115).
- ⚠️ **First-hand does not mean better data.** RWS is first-hand with null dates; bigevent.io is
  second-hand with clean ISO instants. A record-level "first-hand wins" rule would discard good data
  for bad, so #129 is handed a **field-level merge** rather than a winning row.
- **Second-hand sources import soft dates.** 16 of 96 EventsEye rows carry no firm date, rising with
  distance. Handled at parse time under ADR-0006's three outcomes, not by the admin.
- **`ADR-0005`'s adapter seam is unchanged and untested by this.** Every admitted aggregator is a
  plain HTTP scrape; none needs a browser.

## Alternatives rejected

- **Keep #13 and accept no MBS or Singapore EXPO coverage.** Both venues bar scraping in their own
  terms, and MBS publishes only 3 days forward regardless. This would concede the two largest MICE
  venues in Singapore — 78% of the trade shows measured.
- **Reverse #13 silently, by simply listing aggregators as sources.** The map's standing rule forbids
  reversal by drift. #112 recorded that this reversal *looked assumed while charting*; this ADR is
  the correction.
- **Reverse on #13's own two claims.** Rejected on evidence: claim 1 accounts for 6% of the value and
  claim 2 is refuted. Reversing on reasons that do not survive testing would leave the decision
  resting on nothing.
- **Admit aggregators as a fourth reason — "they reach venues whose terms bar us".** Considered and
  dropped once #128 ruled that v2 scrapes barred sources anyway for the MVP and seeks permission in
  parallel (the standing rule, and its limits, belong to
  [#123](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/123)). If terms do not stop
  us, they are not a reason.
- **Model credibility as a second ranking axis.** Dropped: the admin checks entries by hand, so the
  axis would inform nothing the code does.
- **Put provenance on the `Source` interface.** Rejected — see *Decision*.
