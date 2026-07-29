# Context: Singapore tourism & MICE demand calendar

A web calendar + iCal subscription for **Singapore tourism industry professionals** —
hoteliers, tour operators, F&B, retail, venues — who plan around demand landing.
It aggregates heterogeneous public sources into **existence + timing** records,
refreshed daily.

## Glossary

### ⛔ Event

**Banned as a bare term.** "Event" was doing at least two incompatible jobs — a
thing people attend, and a ship docking that nobody attends — and forcing them
into one schema is what produced a `description` field that meant nothing.
Say **VenueEvent** or **PortCall**. Never "event" unqualified.

### VenueEvent

Something scheduled at a venue, that people attend. A conference, an exhibition,
a concert, a consumer festival.

Deliberately **not** `MiceEvent`: Suntec's listings mix business meetings
(BNI Vision) with consumer events (Cellar Fiesta). MICE would misname the latter.
The honest common property is that something is scheduled at a venue.

| Field | Notes |
|---|---|
| `uid` | Durable. Minted once, never recomputed. See **UID**. |
| `sequence` | Bumped when content changes under a stable key. Named for RFC 5545 `SEQUENCE` but **not serialized into the feeds** — see ADR-0008 §5. |
| `source` | Which adapter produced it. Duplicates are accepted and labelled by source. |
| `sourceKey` | See **sourceKey**. |
| `name` | The event's name, as published. |
| `start`, `end` | **Instants** (UTC). See **Timing**. |
| `venue` | e.g. Suntec Convention Centre. |
| `hall?` | e.g. `Level 4, Hall 404`. Nullable. |
| `firstSeenAt`, `lastSeenAt` | See **Seen-tracking**. |

**No `description` field.** See **Facts-only extraction**.

### PortCall

A ship berthing at a Singapore cruise terminal. Nobody attends it. Its value to
the audience is that it lands thousands of people nearby.

| Field | Notes |
|---|---|
| `uid`, `sequence`, `source`, `sourceKey` | As **VenueEvent**. |
| `vessel` | The vessel string **as published, unsplit**. See below. |
| `terminal` | MBCCS or Singapore Cruise Centre — the only two (MPA). |
| `berth?` | Pier number. Nullable. Not reader-facing; demoted to `description`. |
| `arrival`, `departure` | **Instants** (UTC). |
| `firstSeenAt`, `lastSeenAt` | See **Seen-tracking**. |

`vessel` is **not split into ship and line.** SCC concatenates them into one cell
(`ODYSSEY / VILLA VIE RESIDENCES`) delimited by whitespace only; ship names are
multi-word, so no rule splits it reliably, and a bad split would silently corrupt
`sourceKey`. MBCCS publishes no line at all.

### CalendarEntry

The projection both types serialize through — named for its role, not its meaning.
It is what the web calendar, the iCal feed, and (later) Excel render.

```
CalendarEntry { uid, summary, start, end, location, description, source }
```

Projection rules:

| | VenueEvent | PortCall |
|---|---|---|
| `summary` | `name` | `Cruise: {vessel} at {terminal}` |
| `location` | `venue` (+ `hall`) | `terminal` — never the berth |
| `description` | **generated** | **generated** (includes berth) |

`summary` carries the category as **prose** because `CATEGORIES` survives on only
1 of 3 iCal clients (see ADR-0001, issue #6). The feed is split by type into two
subscriptions (see **Feeds**, ADR-0008), but every entry still renders into one
calendar grid — the split is a subscription boundary, not a schema difference.

**CalendarEntry is a convenience, not a bottleneck.** It flattens away `vessel`,
`hall` and `berth`. A serializer needing those (a future Excel export) reads the
domain types directly.

### Feeds

The iCal subscription surface is **two feeds, split by type** — never a single
firehose, never split by source:

| Feed | `X-WR-CALNAME` | URL | Contents |
|---|---|---|---|
| Port calls | SG Cruise Arrivals | `/feeds/port-calls.ics` | every `PortCall` |
| Venue events | SG Venue Events | `/feeds/venue-events.ics` | every `VenueEvent` |

Split by **type**, because the audience thinks in demand shapes, not scrapers — and
`source` already rides inside every entry, so per-source feeds would only fragment
attribution that is not lost. **No `all` feed:** the unfiltered, duplicate-heavy
stream is not a subscription anyone should hold; the *everything* view is the web
calendar, which filters client-side for free.

Consequence: **the feed set grows with types, not sources.** A new source (e.g.
ticketed events, #13) folds into `venue-events` and adds no feed. `CATEGORIES` cannot
carry the split in-feed (ADR-0001, #6), which is why the split is baked into distinct
URLs at generation time. See ADR-0008.

The **subscription surface** — how a reader gets one of those two URLs — is a block on
the **Web calendar**, below the methodology notes: the heading, one row per feed, and a
Copy. Its URLs are **absolute**, on the page and on the button alike. The site's own
links can be relative because a browser resolves them against the page, but a calendar
app is handed the string alone and has nothing to resolve it against — so a relative
feed URL is one that cannot be subscribed to, which is the block's entire job. Nothing
around it explains how to add a subscription in any particular app: the product owner's
edit, #76.

Its heading reads **"ICS Calendar Subscription"** — a reader's words, not this glossary's
"iCal". The two name the same format; the heading takes the spelling a reader is most
likely to have met on the calendar app they are about to paste into. Prose here still
says iCal.

### Web calendar

The *everything* view #11 made load-bearing (there is no `all` feed). It carries the
full dataset — both types, all sources, duplicates labelled — in a **static** page,
filtered client-side. It offers **four switchable views**; no single one is *the*
view, and reading demand from multiple perspectives is the point:

| Order | View | Question it answers | Role |
|---|---|---|---|
| 1 | **Month** | which days have demand? | **default landing / navigator** |
| 2 | **Week** | this week, hour by hour? | reading surface |
| 3 | **Agenda** | what exactly, and where? | reading surface |
| 4 | **Date-spine** | how long / how much? | reading surface |

- **Default landing is Month, as a navigator** (orientation — "which days are live"),
  **not** a magnitude-reading surface. This keeps #5 intact: #5 disqualified the grid
  as the place to *read* magnitude, not as an entry point to *drill from*.
- **Type filter** (All / VenueEvent / PortCall) across every view — the interactive
  counterpart to the two baked feeds (see **Feeds**).
- **Multi-day events appear on every day they span** — a multi-day event is demand on
  each of its days.
- **No magnitude.** The density-inversion (a count/spatial view ranks five trivial
  marks above one 40k congress) is mitigated **structurally** — Date-spine makes
  duration literal, Agenda names entries — not by impact-scoring. **Accepted hole:** a
  **PortCall** has neither span nor name, so a ~4,000-passenger ship renders like a
  coffee popup in every view; the audience infers size from `vessel`. **Reopen
  trigger:** if real use shows this misleads, magnitude re-enters scope as a
  *destination redraw*, not a quiet patch. The two **`+N more`** doors — Month's cell
  (see **Chip**) and Week's **All-day band** — are not a magnitude reading: each counts
  what one bounded surface could not fit, and names a destination rather than ranking a
  day against its neighbours.

Everything is **static-renderable** (ADR-0009, #10): the views, filter, week paging,
and Today control are client JS over data already on the page — no server. The UI
library that implements this (if any) is gated by licensing (#14), not settled here.
See ADR-0009.

### Chip

How **Month** draws a **CalendarEntry**: **one line**, the summary alone, its type
carried by colour. It is a leaf, not a stack. The reading surfaces draw the same entry
in full (name, where, source) — with two exceptions, Week's **All-day band** and
**Date-spine**'s **Bar**, each of which draws less for its own surface's reason — and
that difference *is* the navigator/reading-surface split made visible: a chip answers
"is there demand here", not "what is it".

Chips are **capped per day** — four rows to a cell, and the overflow past them
collapses to a **`+N more`** that drills into that day in **Agenda**, spending a row
itself so an overflowing day is never taller than a full one. That cap is what fixes
Month to one screen (ADR-0014 §1).

What the line has no room for is on the chip's tooltip, not lost: the location, and
the **source** label that every entry on a reading surface carries. Deliberate, and a
narrowing of #38's "every entry is labelled with the source" — the attribution is one
drill away, on the surface `+N more` hands the reader to. For the same reason the chip
drops a port call's `Cruise: ` prefix: on a chip that narrow it crowds out the
`vessel`, which is the only thing telling one call from another. ADR-0001 keeps that
prose inside `summary` because an iCal client has nothing else to carry the category;
the chip has its colour.

### All-day band

Where **Week** draws an entry spanning more than one day. A multi-day entry has no
single hour, so it cannot honestly be placed in the hour grid; it rides a band above
it, across the columns it covers.

Two rules the band does not share with the hour grid below it:

- **All-day ranges are inclusive of their end day.** An entry running 20–22 Jul
  *occupies* the 22nd, so one starting on the 22nd shares a day with it and must not
  share a lane. The shared interval packer is half-open — which is right for the
  **Date-spine**'s day-values and the hour grid's minutes, and both keep it — so the
  band converts inclusive to exclusive at its own call (`endIndex + 1`). Getting this
  wrong drew two touching entries on top of each other; it was one of round 1's two
  production bugs (#81).
- **The band reserves a fixed number of lanes** (four) whatever the week holds, so a
  quiet week and a busy one are the same height and paging never shifts the hour grid.
  Past the reservation the entries collapse into a **`+N more`** that spends the last
  reserved lane itself and drills to the earliest hidden entry's day in **Agenda** —
  the same door Month's **Chip** cap opens, and no more a magnitude reading than that
  one. On today's dataset the worst week needs exactly the reserved lanes, so the door
  is insurance rather than everyday behaviour.

A fixed lane height means a band is **one line**, so — alone among the reading
surfaces — it draws the same leaf a **Chip** does, and narrows #38's source label onto
its tooltip for the same reason. #81 — a net-new round-1 item, so it is spec'd on the
issue rather than in ADR-0014.

### Legibility marks

The faint hairlines that quarter **Week**'s day at 06:00, 12:00 and 18:00, behind the
entries, starting where the hour-label gutter ends. They are what lets an entry's time
be read off its vertical position without counting down from the gutter. The day is
enclosed by a matching pair: its 00:00 line is the **all-day band**'s bottom border and
its 24:00 line the hour grid's own. The day is quartered *once*, across the grid — the
columns paint no rule of their own, because two griddings of one axis are two competing
readings of it. #78.

### Bar

How **Date-spine** draws a **CalendarEntry**: **the name alone**, spanning the whole date
rows the entry occupies. Its height *is* its duration, which is the whole point of the
view, so the height is not free to grow to fit text: a one-date entry is one row, and one
line at the spine's own type scale is what that row holds. The name fills every line the
bar's height allows and ellipsises where more remains — never a silent cut, which would
leave a truncated title and a short one looking the same.

So the **Bar** is the second exception to a reading surface drawing the entry in full
(see **Chip**): the location and the source come off, and a port call's `Cruise: `
prefix with them, for the reasons the **Chip** drops the same three. A **third**
narrowing of #38's "every entry is labelled with the source" — the attribution is on
the tooltip and in the **Entry-detail bubble**, not lost.

**How long is not on the Bar at all.** The height says *which dates* and rounds to whole
rows, so it cannot say whether one row is eight hours or twenty; the **Entry-detail
bubble**'s `Length` is the only surface that answers that. The one readable line a
one-date bar has goes to the name, because a reader scanning the spine needs to know
*what* before *how long* — and the rounding is still worth its cost, since a bar drawn to
the clock makes a six-hour entry a sliver too small to name, starting part-way down a row
it lines up with nothing on.

Concurrent entries are **lane-packed** side by side, and a **Bar** is inset by a
hairline on all four edges. Both hairlines are load-bearing, not polish: without the
vertical one, consecutive days in one lane paint flush and read as one long entry;
without the horizontal one, so do two neighbouring lanes, which is how a cruise arrival
and a venue event come to share an edge with no gutter between them.

#98, #100, ADR-0015 and ADR-0016.

### Week-boundary line

The rule **Date-spine** draws at the top of each Monday, across the date axis *and* the
bar track, so a column of floating bars reads as one week at a time rather than as one
undifferentiated run of durations. It is stronger than the daily hairline the axis
already carries (32% against 18%), because a week has to stand out from a day, and it
sits *behind* the bars: an entry paints over the line, never the line across the entry.

Monday is read from the same single fact the week views' geometry and their Monday-first
weekday labels read from, so **Date-spine** and **Week** can never disagree about where a
week starts.

It also fixes the axis and the track to **one row unit**: the track is exactly as tall as
the month is long, so one percentage names the same row on both. The flat minimum height
it replaces agreed with the axis only in a 31-day month — in a 30-day one every bar sat
progressively low, which the line made visible the moment it had to land on a row's edge.
#74 — a net-new round-1 item, so it is spec'd on its issue rather than in ADR-0014.

### Entry-detail bubble

The small anchored popover a **double-click** on an entry opens, on any view — the
**Month** chip, **Week**'s **all-day band** and its timed entries, the **Agenda** row,
the **Date-spine** bar. The `+N more` doors are excluded: a door navigates, it does not
describe an entry.

Its job is **not more fields**. The dataset is existence and timing (see
**CalendarEntry**), so the bubble shows the few honest fields *in full* — the title every
at-rest surface truncates, the location a leaf drops, the source a **chip** moves to its
tooltip — and invents none. Type in the reader's words ("Cruise arrival" / "Venue
event"), When, Time, Where, Length, and a footer naming the entry's own source and how
long ago it was confirmed, computed from the same `payload.sources` and injected clock
the page's **Source health** disclosure reads.

**Length** is the exception to "the bubble repeats what a surface truncated": no at-rest
surface says how long any more (see **Bar**), so the bubble is not showing that field in
full — it is the only place it is shown at all.

Its **content** is a pure function of the entry and is covered at seam 3. Its
**geometry** is deliberately not: the bubble is placed in viewport coordinates, flipping
above near the bottom edge and clamping horizontally with its tail kept on the node, and
every number in that comes from a layout engine jsdom does not have. Two costs are
accepted rather than papered over: a scroll **closes** the bubble instead of following
its node, and it has no keyboard opening. #75 — a net-new round-1 item, spec'd on its
issue rather than in ADR-0014, and the one item that brings the prototype's *visual*
identity into scope (`prototype/event-bubble`, variant E).

### Weekend wash

The light grey (4%) **Month** and **Week** carry on Saturday and Sunday — one grey,
one meaning, both views. In Month it is the cells and the two column headers above
them. In Week the wash is a property of the **column**, so it runs the full height of
the view: the header cell, the **all-day band**, and the hour column below. The band
is one seven-column grid rather than seven nodes, so it takes the wash as a gradient
over its last two sevenths; anything less and the wash reads as three unrelated
stripes rather than one Saturday and one Sunday.

It is **structural**: a property of the *day*, marked with
an `is-weekend` class read from the date, never an `nth-child` position rule (which
drifts the moment anything else joins the grid — the round-1 prototype hit exactly
that, and the trap is worse in Week, whose grid carries the hour gutter and the
quartering hairlines as leading children, so counting from the front lands three
columns off). Its counterpart rule is **grey means exactly one thing in this grid: weekend.**
So nothing else tints a cell: today is a red disc alone (#71), and an **outside-month**
day — one the Monday-first grid pads a week with — carries no wash of its own. The
weekend wash runs straight through it unbroken; it recedes instead by fading its own
contents (numeral and **chips**) to 25%. With no wash left to announce a month
boundary, the **1st** prints its month name beside the numeral ("1 Jul", "1 Aug") —
in the Week header too, at an explicit small size, since that cell has no date row to
inherit one from. #72 (Month) and #78 (Week) — net-new round-1 items, so they are
spec'd on their issues rather than in ADR-0014 (which records only that round's
*reversals*).

### Facts-only extraction

Extract event **facts** (name, date, venue, vessel) and never copyrightable
**expression**. This is simultaneously the product constraint (existence + timing)
and the strongest legal position in Singapore — they turn out to be the same line.

Consequently **no scraped `description` exists on either type.** The scraped blurb
was ~8% populated on Suntec, absent from both cruise sources, and was the single
weakest thing we would have held legally. The iCal `DESCRIPTION` property survives
as prose **we** generate — attribution and category, 100% populated, 0% scraped.

Extraction beyond facts requires a fresh legal read.

### sourceKey

An **opaque** string each adapter computes to identify a record within its own
source. The core never inspects it; identity is `(source, sourceKey)`.

The three sources cannot agree on what a key is, which is exactly why this is the
adapter's business and not the core's:

| Source | `sourceKey` | Stability |
|---|---|---|
| MBCCS | `raw.id` | Stable — a real source ID. |
| Suntec | slug from detail URL (`bni-vision1472026`) | **Assumed** stable. Unverified. |
| SCC | `{vessel}\|{arrivalDate}` | **Duplicates on reschedule; a same-day repeat call collides — now reported, not silent.** Unavoidable. |

**Known limitations, accepted for v1:**

- **SCC duplicates on reschedule.** The table exposes nothing stable, so a shifted
  arrival is a delete-plus-create, not a move.
- **SCC collapses a vessel calling twice on one local date.** The same missing
  identifier, read the other way: two calls yield one key. Left silent it would be
  **invisible to every signal in § Source health** — the second upsert overwrites
  the first, and the lost call was never in a prior cohort, so ADR-0007's net-drop
  detection cannot see it go. So the parser makes it audible ([#48], done): when
  two rows in one scrape produce the same `{vessel}|{arrivalDate}`, the **first** is
  kept and the second is emitted as a `ParseFailure` carrying its row and naming the
  collision, surfacing through `failures[]` like any other broken row. The key
  itself is still not made unique — there is no honest fix without upstream data
  that does not exist — but the collision is no longer a silent overwrite. Not
  observed in the published window (17 sailings, 17 distinct keys).

  [#48]: https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/48
- **Suntec's slug embeds a date** (`1472026` = 14/7/2026). A Squarespace slug is
  frozen at creation rather than re-derived, so it *should* survive a reschedule —
  but this has not been observed and is an assumption. If wrong, Suntec inherits
  SCC's flaw. Contained inside the adapter, which is the point of the opaque key.

### UID

**Durable state, not a function of content.** Minted once on first sight, persisted,
and **never recomputed** — looked up by `(source, sourceKey)`.

Every candidate hash input is mutable: hash the title and a typo fix duplicates the
event; hash the start date and a *rescheduled* conference duplicates rather than
moves — precisely the change subscribers most need delivered as an update. Same key
+ changed content = same UID, bump `sequence`.

### Seen-tracking

Records are **never hard-deleted**. Each carries `firstSeenAt` / `lastSeenAt`; a
scrape upserts by `(source, sourceKey)` and bumps `lastSeenAt`. Absence simply means
`lastSeenAt` stops advancing.

A record absent from today's scrape could mean cancelled, rescheduled, scrolled past
the ~3-month window, or **the scraper silently broke** — the source never says which.
So the model records the observation and refuses to infer a status it was never told.

This preserves the UID across a disappearance and reappearance, and gives **Source health**
its raw signal.

### Source health

A source is **unhealthy** when the pipeline has reason to suspect it can no longer be read.
Four signals, three from the parser (see **Source**, ADR-0006) and one from the core:

| Signal | Meaning |
|---|---|
| `fetch` threw, post-retry | Could not acquire the document. |
| `ok: false` | Anchor absent — not our document (challenge page, redesign, 200-with-an-error). |
| `failures[]` non-empty | Some rows broke. |
| **Net drop ≥3 in the future-dated cohort** | The quiet one. See below. |

The **future-dated cohort** is the records from a source whose `end`/`departure` is still
ahead of `now`. A record has **vanished** when it was in the previous run's cohort, is
still future-dated now, and is absent now. Appearances offset vanishings — so the measure
is **net**.

Both qualifiers carry weight. *Future-dated* excludes a conference that merely happened:
it leaves the cohort by exiting it, not by vanishing from it — which is what makes the
healthy baseline **net zero or positive** for every source at every size. *Net* absorbs
SCC's reschedule flaw (see **sourceKey**) by construction: a delete-plus-create is one out,
one in, net zero, while a dead selector takes rows away and puts nothing back.

**Unhealthy is a suspicion addressed to the operator, never a fact about a record.** There
is no `status: broken` field. **Seen-tracking** refuses to resolve absence into a status
the source never stated, and detecting breakage does not reverse that. See ADR-0007.

### Scraped

What an adapter can honestly return: **observation, not memory.**

```
Scraped<T> = Omit<T, 'uid' | 'sequence' | 'firstSeenAt' | 'lastSeenAt'>
```

A parser reads a page. It knows `name`, `start`, `end`, `venue`, `hall`, and computes
`sourceKey`. It **cannot** know:

| Excluded | Why |
|---|---|
| `uid` | Durable state, looked up by `(source, sourceKey)`. Today's HTML has no access to that memory. |
| `sequence` | A comparison against stored state the parser has never seen. |
| `firstSeenAt` | A fact about our observation history, not about the page. |
| `lastSeenAt` | Same. |

**The adapter observes; the core remembers.** If `parse` returned a full **VenueEvent**
it would have to fabricate those four — including minting a `uid` on *every scrape*,
which is precisely the recompute that **UID** forbids, and which duplicates a rescheduled
conference instead of moving it. The type makes that bug unwritable rather than merely
discouraged.

All **UID** minting, `sequence` diffing and **Seen-tracking** live in the core, once.

Not a third domain type — it is **VenueEvent**/**PortCall** minus what we remember.
See ADR-0005.

### Source

The seam every scraper implements. `fetch` does all the I/O and returns opaque `Raw`;
`parse` is pure and fixture-testable. `Raw` is adapter-owned and never inspected by the
core — so a caller cannot tell that MBCCS drove a headless browser while Suntec did a
plain GET.

```
Source<T, Raw> {
  key
  fetch(deps): Promise<Raw>                  // http (rate-limited), browser?, now
  parse(raw, now): ParseResult<Scraped<T>>   // pure
}
```

Each source's scraper is **wholly unique** — the three share no code. The interface
constrains only the edges; the shared pipeline (upsert, **UID**, **Seen-tracking**) is
what it feeds. See ADR-0005 and ADR-0006.

The rate-limited client in `deps` is **required, never defaulted** — reaching the network
is something a caller says out loud, so no code touches the live internet by forgetting to
pass a stub. See ADR-0010.

### Timing

`start`/`end`/`arrival`/`departure` are **UTC instants**. There is no all-day shape
and no `RRULE` in v1.

All three sources publish true end times (Suntec 154/154 as a UTC interval on
2026-07-16 and 178/178 on 2026-07-20, when the adapter was built; MBCCS
`unberthingDateTime`; SCC a departure column). The only date-only source was
Ticketmaster, dropped on the legal audit (#3) — which retired the earlier
inclusive-end-date rule along with it. See ADR-0003.

Asia/Singapore is fixed +08:00 with no DST since 1982, so SGT→UTC is lossless and
needs no timezone library.

### Terminal

MBCCS (Marina Bay Cruise Centre) or Singapore Cruise Centre — confirmed by MPA as
the only two cruise terminals, so cruise coverage is complete. SCC relocated from
HarbourFront on 15 July 2026; this was a relocation, not a closure.

### Freshness

The published calendar is **stale** when what a reader can see is older than the last
run that should have refreshed it. Freshness is a property of the **published
artifact** — the feeds and the site a reader actually reaches — and never of a source
or of a record.

**Freshness is orthogonal to Source health, in both directions.** Every source can be
unhealthy while the published calendar is perfectly fresh: yesterday's data, published
today, is a correct answer to a bad scrape. Every source can be healthy while the
published calendar is days stale, if the step that publishes it fails downstream of
every signal **Source health** watches.

The second direction is the one worth naming, because it is the failure this project
exists to prevent — a calendar that was correct on the day it was compiled and is
silently wrong afterwards. A reader cannot tell a fresh calendar from a frozen one by
looking at it; both render.

**The measure is the instant the artifact says it was published** (`generatedAt`), which
advances on every run that publishes — including a run that could read no source at all.

It is emphatically **not** the per-source `lastConfirmed` the page shows beside each
source. That is a **Source health** signal wearing a Freshness costume: it freezes when a
*scraper* breaks, so reading it as freshness reports a stale calendar on the day the
pipeline published perfectly and on time. The two properties are orthogonal, and this is
the one place in the published artifact where they sit side by side and can be confused.

## Decisions

See `docs/adr/`.
