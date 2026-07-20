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
  *destination redraw*, not a quiet patch.

Everything is **static-renderable** (ADR-0009, #10): the views, filter, week paging,
and Today control are client JS over data already on the page — no server. The UI
library that implements this (if any) is gated by licensing (#14), not settled here.
See ADR-0009.

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
| SCC | `{vessel}\|{arrivalDate}` | **Duplicates on reschedule.** Unavoidable. |

**Known limitations, accepted for v1:**

- **SCC duplicates on reschedule.** The table exposes nothing stable, so a shifted
  arrival is a delete-plus-create, not a move.
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

### Timing

`start`/`end`/`arrival`/`departure` are **UTC instants**. There is no all-day shape
and no `RRULE` in v1.

All three sources publish true end times (Suntec 154/154 as a UTC interval; MBCCS
`unberthingDateTime`; SCC a departure column). The only date-only source was
Ticketmaster, dropped on the legal audit (#3) — which retired the earlier
inclusive-end-date rule along with it. See ADR-0003.

Asia/Singapore is fixed +08:00 with no DST since 1982, so SGT→UTC is lossless and
needs no timezone library.

### Terminal

MBCCS (Marina Bay Cruise Centre) or Singapore Cruise Centre — confirmed by MPA as
the only two cruise terminals, so cruise coverage is complete. SCC relocated from
HarbourFront on 15 July 2026; this was a relocation, not a closure.

## Decisions

See `docs/adr/`.
