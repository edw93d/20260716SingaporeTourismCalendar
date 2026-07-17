# ADR-0008: iCal feed shape — two type-split feeds, no firehose

- **Status:** Accepted
- **Date:** 2026-07-17
- **Ticket:** [#11](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/11)

## Context

The iCal surface cannot filter itself. ADR-0001 / #6 established that `CATEGORIES`
survives on only 1 of 3 major clients — Google's Event schema has no field for it —
so a subscriber cannot narrow a single firehose feed to "just cruise arrivals" on
their end. If filtering is wanted, it must be **baked in at generation time** as
distinct feed URLs, generated server-side (here: distinct static `.ics` files on
Pages).

Whether filtering is wanted is not in doubt: the motivating persona for including
port calls at all is a hotelier who wants *only* cruise arrivals landing in their
own calendar. A single feed serves that persona a stream dominated by `VenueEvent`s
they will never act on — and, since duplicates are accepted and unmerged
(ADR-0004), the firehose is the densest, noisiest feed we could ship.

That settles *that* there are multiple feeds. This ADR settles **the axis, the
count, the naming, and what carries the everything-view.**

The available axes were narrower than the ticket premise assumed. The premise
floated "per-source? per-category? both?" — but the domain model (ADR-0001) carries
**no category field**: Suntec deliberately mixes business (BNI Vision) and consumer
(Cellar Fiesta) listings, category exists only as generated prose in `summary`
(ADR-0002). So "per-category" was never available. Only **type** (`VenueEvent` /
`PortCall`) and **source** (Suntec / MBCCS / SCC) were ever real axes.

## Decision

### 1. Two feeds, split by type

| Feed | `X-WR-CALNAME` | URL | Contents |
|---|---|---|---|
| Port calls | SG Cruise Arrivals | `/feeds/port-calls.ics` | every `PortCall` |
| Venue events | SG Venue Events | `/feeds/venue-events.ics` | every `VenueEvent` |

### 2. Type, not source

Subscribers think in **demand shapes** — "cruise arrivals", "what's on at venues" —
not in which scraper produced a row. Attribution is not lost by omitting per-source
feeds: `source` already rides *inside* every entry (it is how ADR-0004 labels the
accepted duplicates). And `venue-events` **is** the Suntec feed today — Suntec is
the only `VenueEvent` source — so a per-source split buys nothing on the venue side
while doubling the menu on the cruise side.

### 3. No firehose

There is deliberately no `all` feed. The unfiltered, duplicate-heavy stream is not a
subscription anyone should hold. **The everything-view is the web calendar**, which
carries the full dataset in a static page and filters client-side for free (by type,
source, date — anything the data holds). "Want everything → use the web calendar" is
the whole justification for omitting the firehose, which makes the web calendar's
whole-picture view load-bearing rather than decorative (see Consequences).

### 4. Naming

- **URLs use the domain terms verbatim** — `port-calls`, `venue-events`. The "bare
  Event is banned" discipline (ADR-0001) reaches the URL surface; a friendlier-but-
  vaguer slug (`/cruise.ics`) reintroduces the "ships or river cruises?" ambiguity
  the vocabulary exists to kill.
- **`X-WR-CALNAME` is audience prose with a market prefix** — "SG Cruise Arrivals",
  "SG Venue Events". This label sits in the subscriber's sidebar beside their own
  work calendars, so it must announce *whose* data and *which* market at a glance,
  in language a hotelier reads without having seen the glossary. Revisit when the
  product has a real name.

## Consequences

- **The feed set grows with types, not sources.** A new *source* — ticketed events
  via SISTIC (#13), a second venue — folds into an existing type feed and adds **no**
  URL. A new feed appears only if a genuinely new *type* is ever introduced. The menu
  stays a two-choice decision as sources multiply.
- **The web calendar's everything-view is now load-bearing for the subscription
  story.** Killing the firehose rests entirely on "use the web calendar for
  everything." This sharpens #12 (UI prototype): the web calendar must deliver the
  whole-picture view — and, by strong implication, a **type filter** as the
  interactive counterpart to the two baked feeds. The capability is free (static +
  JS); which controls ship is #12's call. If #12 concludes the web calendar cannot
  or should not carry the everything-view, **that is cause to reopen this ADR's
  no-firehose stance**, not to ship without it.
- **Both feeds stay static-renderable**, honouring #10's contingency: each is one
  `.ics` file regenerated per daily run, no per-request compute, so Pages serves them
  serverless.

## Alternatives rejected

- **A single firehose + client-side filtering** — not a real option. It was only ever
  viable if `CATEGORIES` survived in-client, and #6 found it does not.
- **Split by source** — fragments attribution that is already carried in-entry, and
  produces `venue-events == suntec` today for no gain; scales badly (a new source =
  a new feed) exactly against the audience's mental model.
- **Per-terminal cruise feeds** (MBCCS vs SCC) — genuinely defensible: the terminals
  are geographically distinct and "thousands of people nearby" is inherently local, so
  a Marina Bay hotel may want MBCCS arrivals only. Consciously **deferred, not
  overlooked** — v1 takes the clean type split; reopen if the audience asks for
  locality.
- **An `all` feed alongside the two** — one more static file at zero compute cost, but
  it re-admits the noisy, duplicate-heavy stream this decision exists to refuse, and
  undercuts the web calendar's everything-view role. Rejected as a product stance, not
  on cost.
