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
Say **VenueEvent**, **PortCall**, **FlightArrival** or **ArrivalsSummary**.
Never "event" unqualified — and note that an `ArrivalsSummary` is not an event
at all: nothing happens, a day is counted.

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
| `source` | Which adapter produced it. **Duplicates are accepted and labelled by source** — nothing groups them; a person hides the copies. See **Hidden**, ADR-0024. |
| `sourceKey` | See **sourceKey**. |
| `name` | The event's name, as published. |
| `start`, `end` | **Instants** (UTC). See **Timing**. |
| `venue` | e.g. Suntec Convention Centre. |
| `hall?` | e.g. `Level 4, Hall 404`. Nullable. |
| `firstSeenAt`, `lastSeenAt` | See **Seen-tracking**. |
| `hidden` | A person's judgement that this should not be on the calendar. See **Hidden**. |
| `reviewed` | That a person has *looked* at it. Not a verdict. See **Reviewed**. |

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

### FlightArrival

One inbound passenger flight landing at Changi, on one date. **Never a calendar
record**: it has no `uid`, never reaches `CalendarEntry`, and never enters a feed.
It exists so an `ArrivalsSummary` can be recomputed, and so a country question
asked later can still be answered — landed data has **no backfill** (#25), so a
discarded row is gone permanently.

| Field | Notes |
|---|---|
| `source`, `sourceKey` | As **VenueEvent**. `sourceKey` is `{date}\|{flightNumber}\|{scheduledTime}`. |
| `flightNumber`, `airline` | As published. Codeshares are already collapsed by the source — a naive count is the aircraft count, not the marketing-flight count. |
| `originAirport` | IATA code. |
| `originCountry` | ISO-3166 alpha-2, published directly as `origin_dep_country`. **No airport→country table enters this project** (#25). |
| `scheduledDate` | The SGT calendar day. **The tally key** — and the field the source lies about; see below. |
| `scheduledAt` | Instant (UTC). |
| `actualAt` | Instant (UTC). Null until it lands. |
| `status` | `null` \| `Scheduled` \| `Landed` \| `Cancelled`. `null` beyond ~D+1 — the forward feed **cannot** filter on status. |
| `aircraftType` | Kept solely because it is the only lever that could ever turn *flight count* into *rough capacity*. |
| `firstSeenAt`, `lastSeenAt` | See **Seen-tracking**. |

**Scheduled and landed are not two records.** The same row is first seen up to a
month ahead with `status: Scheduled` and a null `actualAt`, and later gains both.
Upsert by `(source, sourceKey)` already does this; no new mechanism is involved.

**Deliberately not stored:** belt, gate, check-in row, baggage and off-block
timestamps, arrival terminal. Airport operations, no tourism meaning.

⚠️ **`scheduled_date` is a cursor, not a filter.** The source positions a scan at
that date and spills past it; an out-of-range date returns unrelated later rows
rather than nothing. Every row whose `scheduledDate` differs from the date
requested **must be discarded in `parse`**. This fails silently — it yields a
plausible number for the wrong day.

### ArrivalsSummary

One record per **calendar date**: how many inbound flights that day, and the top
three origin countries. Not a thing at a place at a time — **a day, counted**. It
is the only record in this project with a `date` and no instants (ADR-0019).

| Field | Notes |
|---|---|
| `uid`, `sequence` | As **VenueEvent**. `sequence` bumps as the numbers firm up. |
| `date` | The SGT calendar day. Exactly one summary per date. |
| `scheduledCount`, `scheduledTop3` | Every `FlightArrival` for that date. |
| `landedCount`, `landedTop3` | Those that reached `Landed`. |
| `firstSeenAt`, `lastSeenAt` | See **Seen-tracking**. |

**Every number is recomputed from `FlightArrival` rows on every run** — nothing is
written once and trusted. So a tally bug is fixable retroactively, and the gap
between scheduled and landed is real signal (cancellations, diversions, flights
not yet published a month out), not error.

Countries render as **ISO-2 codes, not names** — no country-name lookup table
enters this project.

**Magnitude is in scope for arrivals only.** Map #1 ruled magnitude out; #28
reversed that **for flights and nothing else**. A `PortCall` still carries no
passenger count, so a ~4,000-passenger ship still renders like a coffee popup —
a known, accepted hole, now sitting on the same grid as a flight tally that does
show magnitude.

### CalendarEntry

The projection every calendar-bearing type serializes through — named for its role,
not its meaning.
It is what the web calendar, the iCal feed, and (later) Excel render.

```
CalendarEntry { uid, summary, start, end, location, description, source }
```

Projection rules:

| | VenueEvent | PortCall | ArrivalsSummary |
|---|---|---|---|
| `summary` | `name` | `Cruise: {vessel} at {terminal}` | see below |
| `location` | `venue` (+ `hall`) | `terminal` — never the berth | `Changi Airport` |
| `description` | **generated** | **generated** (includes berth) | **generated** — both lines in full, plus the flights-not-passengers caveat |
| `start`/`end` | instants | instants | **dates** — all-day, exclusive `DTEND` (ADR-0019) |

`summary` carries the category as **prose** because `CATEGORIES` survives on only
1 of 3 iCal clients (see ADR-0001, issue #6). The feed is split by type into
separate subscriptions (see **Feeds**, ADR-0008), but every entry still renders into
one calendar grid — the split is a subscription boundary, not a schema difference.

**`ArrivalsSummary`'s summary is two lines on the web calendar and one in the feed.**
Both measures always show; the landed line reads `-` until it is known:

```
Scheduled: 100, CN 20, ID 15, AE 10
Landed: 85, CN 15, ID 10, AE 5
```

An entry title is a **single-line field**, and clients disagree on encoded line
breaks — some render two lines, some run them together, some truncate everything
after the first. So the feed joins them: `Scheduled: … | Landed: …`, with the
two-line form in `description`. The website renders the two lines as written.

The date is **not** repeated in the summary; the entry already sits on it.

**`Landed: -` can be permanent, and that is deliberate.** Changi retains roughly 72
hours of landed data with no backfill, so a pipeline outage past two runs leaves that
day unknowable forever. The calendar says it doesn't know, rather than showing
nothing.

**CalendarEntry is a convenience, not a bottleneck.** It flattens away `vessel`,
`hall` and `berth`. A serializer needing those (a future Excel export) reads the
domain types directly.

### Feeds

⚠️ **v2 builds no feeds. This whole section describes v1, and returns in v3** (ADR-0025 §3).
Nothing below is **reversed** — the two-type split, the no-`all` rule and their reasons are intact
and correct; they simply bind nothing while v2 ships the **Web calendar** alone. What the deferral
buys is that an iCal subscription is a **mirror**, so an entry dropped from a feed is *deleted* from
a subscriber's calendar — which is what made retention hard, and is a question v2 no longer has.
v1's published `.ics` files stop being updated; every minted **UID** is preserved across the store
migration precisely so v3 can turn them back on without rebuilding anyone's calendar.

The iCal subscription surface is **one feed per type** — never a single
firehose, never split by source:

| Feed | `X-WR-CALNAME` | URL | Contents |
|---|---|---|---|
| Port calls | SG Cruise Arrivals | `/feeds/port-calls.ics` | every `PortCall` |
| Venue events | SG Venue Events | `/feeds/venue-events.ics` | every `VenueEvent` |
| Flight arrivals | SG Flight Arrivals | `/feeds/flight-arrivals.ics` | every `ArrivalsSummary` |

**Flight arrivals is its own feed for a reason beyond the rule.** It emits an entry
**every single day, forever** — a permanent daily banner, where the other two fire
only when something is actually happening. Folding it into either existing feed would
contaminate a subscription someone relies on. As its own URL, taking it is a choice.

Split by **type**, because the audience thinks in demand shapes, not scrapers — and
`source` already rides inside every entry, so per-source feeds would only fragment
attribution that is not lost. **No `all` feed:** the unfiltered, duplicate-heavy
stream is not a subscription anyone should hold; the *everything* view is the web
calendar, which filters client-side for free.

Consequence: **the feed set grows with types, not sources.** A new source (e.g.
ticketed events, #13) folds into `venue-events` and adds no feed; a new *type*
(`ArrivalsSummary`, #28) adds one. `CATEGORIES` cannot
carry the split in-feed (ADR-0001, #6), which is why the split is baked into distinct
URLs at generation time. See ADR-0008.

The **subscription surface** — how a reader gets one of those URLs — is a block on
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
full dataset — every calendar-bearing type, all sources, duplicates labelled — in a **static** page,
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
the Today control and the **Landing** it asks for are client JS over data already in
hand — no server round-trip renders anything. The UI
library that implements this (if any) is gated by licensing (#14), not settled here.
See ADR-0009.

⚠️ **The page is static; its data is served.** v1 baked the dataset into the published artifact.
The **Store** is now a hosted Postgres, so the payload comes live from the server that also runs
the admin page — which is why hiding an entry takes effect at once rather than at tomorrow's run.
ADR-0009 is about the **views** and is untouched. The payload stays **whole** and the filtering
stays client-side: it grows by ~1,000 entries a year (~670 venue and cruise records plus 365
**ArrivalsSummary** records), which is small for years, and windowing it would break the filtering
and paging already built. ADR-0025 §4.

### Landing

The day a render brings to the **top of the viewport**. Four things ask for one, and
none of them is the reader scrolling: **first load**, a **view switch**, the **Today**
control, and the `+N more` **drill-through**. Paging with Prev/Next asks for nothing —
that is the reader moving deliberately, and moving them again would undo the step they
just took.

Where the day lands depends on one property of the showing view — **which way it lays
its days out**:

| | Days run | The landing is |
|---|---|---|
| **Month**, **Week** | across the top | the **surface** — the whole view |
| **Agenda**, **Date-spine** | down the page | that day's **row** |

A view with its days across the top has no row further down to bring up, so asking for
one is meaningless: on **Month** it fetched today's *week* row and scrolled the weeks
above it off the screen, which is ADR-0014's "Month is fixed to one screen" broken by
the scroll rather than by the grid. A day the showing view does not draw at all — today,
while the reader is two months back — falls back to the surface too.

This is a **second, independent property of a view**, and it deliberately does not
follow the navigator/reading-surface split above: **Week** is a reading surface that
lands like the navigator. Naming it is what stops someone reading that as an
inconsistency and "fixing" Week back.

**Only a browser can check it.** The test bed has no layout, so it can see *which*
element was asked to come up but never *where the reader ends up* — and "today's cell
came to the top" and "the whole month came to the top" are the same observation without
a viewport. That blindness is how the rule shipped wrong; the prototype that settled it
is the primary source (#107, `prototype/month-landing`).

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

### Week number

The **ISO-8601** number of the week **Week**'s title names — `Week 31, 27 Jul – 2 Aug 2026`.
Demand planning quotes weeks by number, and a bare range gives a reader nothing to say.
Not "week of year", which names a different and looser thing.

ISO is chosen because an ISO week **is** a Monday-first week, so it is exactly the row the
grid draws: the number is a function of the same single fact the week views' geometry, the
Monday-first weekday labels and the **Week-boundary line** all read from. Nothing else can
name these rows. The alternative a reader will notice — CLDR's default, which is what Apple
Calendar shows under `en-SG` — runs its weeks **Sunday–Saturday**, so one row of this grid
straddles two of its weeks and no single number is right for all seven days.

Two readings are correct rather than glitches: a year opening on a Thursday has **53**
weeks (2026 does), and the week numbered 1 can open in the previous December. The
**week-year is implicit** — the dates on the same line carry it — and the range prints
**both** years when it straddles one, since `Week 1` beside a December date is the moment a
reader must be told which December.

The number appears in the **Week title only**: the other three views page by the month and
have no week to number. #109, ADR-0018.

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

### Barred source

A source whose own terms forbid automated access, storage, or republication. Six of
twenty are barred, including two of the three v1 adapters in production.

**v2 reads a barred source anyway** — politely, taking facts only — and seeks written
permission in parallel. It stops on refusal. The rule covers **access, storage and
republication as one**, because permission to merely *scrape* would still leave us in
breach of the clauses that bar archiving and publishing.

**v2 exercises all three limbs: it reads, it stores, and it publishes** (ADR-0026, #144,
06 Aug 2026). The repository is public **on purpose** and carries the code and not the
harvest; the **Web calendar** is public to read, with credentials required only to hide
an entry. There is **no revenue of any kind**, and that is now the only clause-level
defence left — it clears exactly **one** clause on the whole list (Constellar §4.7).

⚠️ **ADR-0021 §5 said the opposite, on a premise that was never true.** It argued from
*"the repository is private"* — as a stated fact, not a decision to implement. The
repository has been public since 16 Jul 2026. **Four clauses were switched off in
`docs/source-register.md` on a fact nobody checked**, and all four are back: SCC's
"internal", Suntec's and MBS's *personal*, Changi's *personal*, and Constellar
§3.1(b)(i)'s *publish* limb.

**SCC keeps running at accepted risk** — not evasion but consistency: MBCCS's "any other
purposes" ban is broader, was never cleared by any version of this project, and has been
in production throughout.

**What survives is conduct, not clauses:** facts-only extraction, politeness, honest
identification, `robots.txt` as a hard stop, and attribution — which ADR-0021 §1 makes
binding for the first time (#145). It clears **no access clause**: scraping is breached
at any price and for any purpose, and that class is irreducible.

⚠️ **Any revenue voids this and requires a re-decision** — the clauses bite retroactively
on the archive already built.

*Barred* is not *stopped*. Five **hard stops** are absolute and no accepted-MVP-risk
ruling reaches them: a `robots.txt` `Disallow` on the path, any authentication wall, an
explicit refusal once received, an active technical block aimed at us, and
impersonation. The asymmetry is deliberate — `robots.txt` is the one instrument
addressed specifically to automated readers, and honouring it absolutely costs nothing
today, since no source on the list blocks us there.

**Silence is null.** A permission notice that goes unanswered is neither consent nor
refusal; the source stays exactly where it was.

ADR-0021 holds the rule and its reasons. [`docs/source-register.md`](docs/source-register.md)
holds the per-source facts — clause, route, `robots.txt` verdict, permission state, and
the date the terms were last read — and is re-read annually and whenever an adapter is
touched.

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

**The UID is held by the record**, and nothing ever retires one. Hiding an entry does not
retire its UID — unhiding restores the same entry to the same subscriber. ADR-0024 §7.

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

⚠️ **`manual` is exempt by name** — it is never fetched, so it has no previous run to compare
against and no signal here can read it. See **Manual entry**.

### Scraped

What an adapter can honestly return: **observation, not memory.**

```
Scraped<T> = Omit<T, 'uid' | 'sequence' | 'firstSeenAt' | 'lastSeenAt' | 'hidden' | 'reviewed'>
```

A parser reads a page. It knows `name`, `start`, `end`, `venue`, `hall`, and computes
`sourceKey`. It **cannot** know:

| Excluded | Why |
|---|---|
| `uid` | Durable state, looked up by `(source, sourceKey)`. Today's HTML has no access to that memory. |
| `sequence` | A comparison against stored state the parser has never seen. |
| `firstSeenAt` | A fact about our observation history, not about the page. |
| `lastSeenAt` | Same. |
| `hidden` | A judgement a person made, possibly weeks ago. Today's HTML cannot see it — and if `parse` returned it, the next upsert would silently un-hide everything ever judged. See **Hidden**. |
| `reviewed` | Same shape of fact, same trap: an upsert that returned it would refill the review queue with work already done. See **Reviewed**. |

**The adapter observes; the core remembers.** If `parse` returned a full **VenueEvent**
it would have to fabricate those six — including minting a `uid` on *every scrape*,
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

⚠️ **The contract survives the ~20-source list unchanged in shape (ADR-0027, #121).** An API
is an ordinary `fetch -> Raw` because `Raw` is opaque (SISTIC, Changi); multi-request
acquisition is navigation inside `fetch`; `sourceKey` stays opaque. **No secret rides in
`deps`** and **`fetch` never reads the store** — no source on the list needs either, each
declined with a reopen trigger. The **User-Agent is one core-owned constant**, not per-source:
one honest string serves every source, including Marina Bay Sands' fussy WAF (ADR-0027 §4,
loosening ADR-0021 §2.1).

⚠️ **`manual` is not a Source.** The hand-entry source (ADR-0024) is absent from the registry
array and implements neither `fetch` nor `parse` — the registry means *what the pipeline goes
and reads*, and `manual` is never read. It is an admin-page→store write path sharing only the
`(source, sourceKey)` identity, which lives in the store schema, not in this interface.
See ADR-0027.

### Provenance

Whether a **Source** publishes its own events or reports someone else's.

| | Meaning | Sources |
|---|---|---|
| **first-hand** | The venue or operator publishing what happens on its own premises. | Suntec, Marina Bay Sands, Singapore EXPO, Sentosa, The Kallang, The Star, RWS, Changi Exhibition Centre, MBCCS, SCC, Changi Airport |
| **second-hand** | Reporting another party's events. | EventsEye, bigevent.io, TTGmice, JustRunLah!, SportPlus SG, VisitSingapore MICE, STB, Eventbrite, Ticketmaster SG, SISTIC |

It is not a quality claim — maintenance quality varies per site and does not track provenance
(RWS is first-hand and publishes `0001-01-01` null dates; bigevent.io is second-hand and
publishes clean ISO instants). It says who *knows*, not who *typed it correctly*.

**A flat property of the source**, applying to everything it publishes: Sentosa is first-hand
for the whole island, including events run by other operators on it. Not derived per record
from the venue — that field is blank too often to key a rule off (bare `Singapore` on 4 of 13
bigevent.io rows and 2 of 96 EventsEye rows).

⚠️ **It drives no behaviour.** Its one job was breaking ties when the same event arrived from
more than one source — step 4 of a field ladder that the MVP does not build (ADR-0024). With no
merging, nothing consults it. It survives because the admin-facing description below is useful
and because the tiebreak returns with matching; see ADR-0024's *Reopen trigger*.

**"Primary" and "secondary" are retired.** They named this same property and were dropped so
the idea cannot resurface as a second axis. Credibility/authority is deliberately not
modelled — see ADR-0020.

Alongside it each source carries an **admin-facing description** — `event venue`, `event
aggregator`, `ticketing platform`, `cruise terminal`, `airport` — which drives no behaviour
and exists so a human reviewing entries can see where one came from.

Both live in the **source manifest**, not in the **Source** contract: `fetch` and `parse`
need neither. See ADR-0020, ADR-0024.

### Hidden

A person's judgement that a **VenueEvent** should not be on the calendar. A single boolean on
the record, and the only moderation state in the model.

**It is a property, not a lifecycle.** There is no state set, no intermediate state and no
transition worth naming — which is worth saying, because #116 asked for a state machine and
this is not one.

| | |
|---|---|
| **Default** | **Visible.** Nothing waits for approval; a newly scraped record renders at once. The admin page is a cleanup list, not a gate. |
| **Effect** | Absent from the web calendar **and from every feed**. One word, one meaning. |
| **Who sets it** | **Only a person.** Never a rule, an adapter or a pipeline step. |
| **Why** | **Not recorded.** The flag says *that*, never *why*, *when* or *by whom*. |
| **Where** | **VenueEvent only.** |
| **Reversible** | Yes, completely — see below. |

⚠️ **Visible-by-default survived publication, on replaced reasoning** (ADR-0026 §8, #144). ADR-0024
argued it partly from *"v2 does not publish"*, which was never true. The argument that carries it is
the other one, and it never knew whether anyone was reading: a few hundred approvals a day is what
stops the MVP existing. Two things arrived since that make it **stronger** — **Reviewed** means the
queue terminates, and the payload is served live so a hide takes effect on click rather than at
tomorrow's run.

Three reasons to hide exist in practice — not tourism or MICE, the same show as another row,
and unusable data — and none of them changes what happens, so none is stored. ⚠️ Accepted
cost: how much of a source is being hidden as irrelevant cannot be counted afterwards.

⚠️ **A wrong date is not a hiding problem and has no moderation answer.** Hiding fixes an
*irrelevant* record; nothing catches a date the parser misread, and on a public calendar someone
plans around it. That needs a stated-limitations line on the page (#145), not a gate.

**Only a person sets it, because otherwise the flag means two things that cannot be told
apart** — *I judged this* and *the software found this odd*. A row that cannot be parsed into
a usable event (RWS's `0001-01-01` dates) is a broken row under **Source health** and never
becomes a **VenueEvent**, so there is nothing for a machine to hide. Sweeping a scraper fault
off the calendar would turn a problem into a tidy-looking answer.

**`PortCall` does not carry it.** There are two terminals, both first-hand, no aggregator
reports them — a duplicate is near-impossible and a ship docking is never irrelevant. A broken
cruise row is a *parser* fault and belongs in `failures[]` where it is visible.
**`ArrivalsSummary` does not carry it** — recomputed every run, one per date by construction,
nothing to judge. **`FlightArrival`** has no `uid` and never renders.

⚠️ **This is not the absence Seen-tracking governs.** A record that stops being scraped keeps
rendering: the model refuses to resolve absence into a status the source never stated, and
`lastSeenAt` simply stops advancing. Only a person's judgement takes an entry off the calendar.

**Hiding is genuinely reversible.** Nothing is retired and nothing is minted, so unhiding
restores the same entry, with the same `uid`, to the same subscriber.

**Remembered, not observed.** `hidden` sits with `uid`, `sequence`, `firstSeenAt` and
`lastSeenAt` on the core side of the observe/remember line and is excluded from **Scraped** —
otherwise the next run's upsert would silently un-hide everything ever judged.

**Hidden records are dropped before projection**, so **CalendarEntry** never carries the flag
and no serializer can forget to check it. The admin page reads **VenueEvent** directly.

ADR-0024.

### Reviewed

That a person has **looked at** a **VenueEvent**. A second boolean beside **Hidden**, and
deliberately not the same fact: `reviewed` says *seen*, `hidden` says *judged off the calendar*.

It exists because with `hidden` alone a **visible record is ambiguous** — nobody has looked at it,
or somebody looked and kept it, and nothing tells the two apart. A cleanup list built on that
re-presents every record already approved, every day, forever, against a ~670-record backfill.

| | |
|---|---|
| **Default** | `false`. A newly scraped record is unreviewed **and visible** — reviewing is not a gate; see **Hidden**. |
| **Who sets it** | **Only a person**, for the same reason as **Hidden**: a machine-set flag would mean two things that cannot be told apart. |
| **Why / when / by whom** | **Not recorded**, as with **Hidden**. |
| **Where** | **VenueEvent only.** `PortCall` carries no relevance judgement, `ArrivalsSummary` is recomputed every run, `FlightArrival` never renders. |
| **`manual` records** | Arrive `reviewed: true` — a person typed it. |

The two flags are **independent**: the review queue reads `reviewed`, the calendar reads `hidden`.
Reviewed-and-kept is the common case.

**Remembered, not observed** — it sits with `uid`, `sequence`, `firstSeenAt`, `lastSeenAt` and
`hidden` and is excluded from **Scraped**, and for the sharper of the two reasons: a scrape that
returned it would refill the queue with work already done. Quieter than un-hiding, and just as
silent.

ADR-0025 §6, amending ADR-0024.

### Store

Where the core's memory lives — everything an adapter structurally cannot know (see **Scraped**).
It is a **hosted Postgres**, reached over the network by both writers; ⚠️ *which host and which
managed offering* is deliberately still open.

It stopped being v1's `data/calendar.sqlite` committed to the repo for two reasons, and **neither is
the size of the data**:

- **There are two writers.** The daily scrape runs in CI and the admin page runs on a server, and
  ADR-0024 has the second writing *while a scrape is in flight*. A file in git has one copy per
  checkout and an undiffable binary has no merge, so one side's writes are lost. Broken on day one,
  not at scale.
- **Some data cannot be re-derived.** Landed **FlightArrival** rows have no backfill (#25), so
  backups became a real job rather than a side-effect of committing to git.

Volume is what breaks **git**, not the database: ~182k flight rows a year is unremarkable to any
database, but a blob committed daily grows the repo by its full size every day.

| | |
|---|---|
| **Writes** | **One transaction per source** — a broken source rolls back its own records and no others (ADR-0006's three outcomes, at the storage level). |
| **The upsert** | Writes **only the fields of `Scraped<T>`**. ⚠️ Never `uid`, `sequence`, `firstSeenAt`, `hidden` or `reviewed` — a write path that touches those un-does every judgement ever made, silently and permanently. |
| **Concurrency** | Nothing invented. Readers do not block writers; a moderator toggling `hidden` mid-scrape is an ordinary concurrent transaction. |
| **Reads** | The **web calendar**'s data payload, served live, and the admin page's review queue reading **VenueEvent** directly. |
| **Relations** | **None.** No join table, no merge lineage, no cluster membership, no negative-ruling store — ADR-0024 removed all of them. `(source, sourceKey)` is the whole of identity. |
| **Retention** | Nothing is ever deleted, raw **FlightArrival** rows included and forever (~250MB a decade). |

⚠️ **The daily run publishes nothing any more.** It scrapes and it upserts. ADR-0011's arrangement —
the store blob and the `.ics` files committed together so the feed diff explained the blob — is gone,
and with it the ability to read a day's change out of git history. Nothing replaces it.

ADR-0025.

### Manual entry

A human can type in an event no source published. It is modelled as a **Source** named
`manual` rather than as a new shape, so `(source, sourceKey)` stays the universal identity:
`sourceKey` is minted by the admin page, `firstSeenAt` is when it was typed, and `lastSeenAt`
is the same instant and never advances.

⚠️ **`manual` is exempt from Source health by name.** The net-drop test compares against a
previous run's cohort; `manual` is never fetched, so it has no runs and the signal has nothing
to read. Without the exemption a frozen `lastSeenAt` would look like a source going quiet.

⚠️ It is the **only** exception to *every record comes from an adapter* — a second write path
into the store. ADR-0024 §9.

### ⛔ Cluster and Matching — not in the MVP

**Grouping duplicate records into one entry is not built.** Nothing joins anything: every
record stands alone under `(source, sourceKey)` and renders as its own entry, and a person
**hides** the copies. Cross-source overlap was measured at **5 duplicates in 194 rows**, which
is a handful of decisions rather than a job.

⚠️ **Accepted cost:** with no merging there is no best-field-wins. Where one source publishes
`Sands Expo, Hall D` and another bare `Singapore`, hiding one keeps whatever the survivor says.

ADR-0022 and ADR-0023 define the cluster, the field ladder and the matching rule in full, and
are the shape to return to — see ADR-0024's *Reopen trigger*. They are not wrong; they are
unaffordable for the MVP. Nothing about them is repeated here, because a domain document that
describes two models at once cannot be read.

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
