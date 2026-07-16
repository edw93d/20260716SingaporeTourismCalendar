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
| `sequence` | RFC 5545 `SEQUENCE`; bumped when content changes under a stable key. |
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
1 of 3 iCal clients (see ADR-0001, issue #6). This holds however the feed shape
question (#11) resolves — separate feeds still render into one calendar grid.

**CalendarEntry is a convenience, not a bottleneck.** It flattens away `vessel`,
`hall` and `berth`. A serializer needing those (a future Excel export) reads the
domain types directly.

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

This preserves the UID across a disappearance and reappearance, and gives breakage
detection (#9) its raw signal.

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
