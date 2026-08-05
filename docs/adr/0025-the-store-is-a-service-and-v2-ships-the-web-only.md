# ADR-0025: The store becomes a hosted Postgres the server owns, and v2 ships the web only

- **Status:** Accepted
- **Date:** 2026-08-05
- **Ticket:** [#117](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/117)
- **Supersedes [ADR-0011](0011-pages-from-an-artifact-feeds-committed-to-the-branch.md)** — the store
  is no longer a file in the repository, and the feeds are not published at all in v2.
- **Defers [ADR-0008](0008-ical-feed-shape-two-type-split-feeds.md)** — the two-type feed split is
  **not reversed**. v2 builds no feeds, so it has nothing to bind until v3.
- **Amends [ADR-0024](0024-moderation-is-one-flag-and-the-mvp-does-not-match.md)** — a second
  remembered boolean, `reviewed`, joins `hidden` on `VenueEvent` (Decision §6).
- **Spends [ADR-0010](0010-network-access-is-injected-never-defaulted.md)'s zero-credentials
  property** — see *Consequences*. The property was already spent by map #112's *there is now a
  server*; this ADR is not what costs it.
- **Confirms [ADR-0004](0004-opaque-source-key-and-seen-tracking.md)** — `(source, sourceKey)` is
  still the whole of identity, records are still never deleted, and the migration re-mints nothing.

## Context

#117 asked what the store must support in reads, writes and relations, and named the load-bearing
sub-question: **does the store stay a file, or become a service?**

v1's answer is `data/calendar.sqlite` — a SQLite file committed to the repository, written by one
batch process in GitHub Actions and read by a static build, with the feeds committed beside it
(ADR-0011). It works because there is exactly one writer and exactly one copy.

Three things arrived that it cannot carry, and Ed named v2's scope directly while grilling: **all
venue sources, all cruise sources, flights, and an admin page with a manual relevance check and
hand-entry.**

**1. There are two writers now.** ADR-0024 landed the admin page: a running server that toggles
`hidden` and writes hand-entered records under the source `manual`, **while a scrape may be in
flight**. A file in git has one copy per checkout — the CI run's and the server's. Both write, both
commit, and the merge is an undiffable binary with no resolution. One side's writes are simply lost.
This is not a scale problem that arrives later; it is broken on the first day both exist.

**2. Flights break git, not SQLite.** #28 ruled in `FlightArrival` at **~182,000 rows/yr**. That is
nothing to a database — SQLite handles hundreds of gigabytes, and Postgres would not notice — but the
blob is committed daily and can neither merge nor diff, so **the repository grows by the file's full
size every single day.** At ~25 MB after a year that is several GB of git objects for a dataset that
is 25 MB at rest. Map #20's constraint predicted exactly this: *the likely pressure is git, not the
database.*

**3. Flight data is the first thing in the project that cannot be re-derived.** Changi retains ~72
hours of landed data with no backfill (#25), so a lost row is a country question that can never be
answered again. Every other record in the store is re-scrapable. This is the first data that must be
treated as durable state rather than as cache — which makes backups a real job rather than a
side-effect of committing to git.

**Volume is not the reason, and saying so matters**, because the wrong reason produces the wrong
follow-up decisions. The events-per-year figure #117 was blocked on (map #112's remaining fog, #26's
never-taken overlap measurement) is *still* missing, and **this ADR does not need it.** The
non-flight sources sum to ~670 records as an order-of-magnitude floor; at that size, and at a hundred
times that size, the store choice is the same. The decision rests on the number of writers and on
durability, both of which are known.

## Decision

### 1. The store is a hosted Postgres. It stops being a file, and stops being in git

Both writers reach it over the network, so the daily scrape stays in GitHub Actions and the admin
page runs wherever it runs, without either owning a disk the other needs.

⚠️ **Which host and which managed Postgres is still deferred**, exactly as map #112 has it under
*Not yet specified*. That question graduates on this ADR; it is not answered by it. What is fixed
here is the **kind** of store — a networked relational service with real transactions and
provider-managed backups — because that is what the reads, writes and durability require, and
choosing a vendor early is expensive and reversible only awkwardly.

⚠️ **`data/calendar.sqlite` stops being committed.** ADR-0011's arrangement — the store blob and the
`.ics` files travelling together in one daily commit so the feed diff explains the blob — has nothing
left to hold together: one side is not a file and the other is not built.

### 2. Postgres was chosen against SQLite-on-a-disk on the writers, not on the data

A SQLite file on the server's own disk fixes the git problem just as completely, keeps every v1 query
and the `better-sqlite3` code exactly as written, and is by far the smaller code change. It was
rejected because **one machine must own the file.** That forces the daily scrape off GitHub Actions
and onto the server before anything else can be built, and it makes backup of the one unbackfillable
dataset a thing to remember rather than a thing the provider does.

### 3. v2 ships the web calendar only. The ICS feeds are v3

**Ed's ruling, and it removes a hazard rather than deferring one.**

An ICS subscription is a **mirror**: an entry dropped from the feed is deleted from the subscriber's
calendar. That is what made #117's retention bullet hard — capping a backward horizon (#18's
documented escape hatch) is not trimming a file, it is reaching into a subscriber's calendar and
removing their record of past demand. With no feed there is no windowing rule to invent, and the
question does not arise.

- **ADR-0008 is deferred, not reversed.** Its two-type split, its no-`all`-feed rule and its
  reasoning are untouched and correct; they bind nothing in v2.
- **[#119](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/119) parks to v3**
  rather than being answered. Per-subscriber feed identity — opaque token or account, and what
  deactivation does to a live subscription — is meaningless with no feed to identify. It is blocked
  on this ticket today; the honest unblock is to move it.
- ⚠️ **v1's feeds are live and public right now** and stop being published. See §7.

### 4. The server serves the reads. The page stays a static build

The web calendar's HTML and JS remain a static artifact — ADR-0009's *everything is
static-renderable* is about the **views**, and it stands. What changes is where the page gets its
data: **the same server that runs the admin page serves the calendar's data payload from Postgres.**

- **Hiding takes effect the moment it is clicked**, on every surface. A daily-rebuild alternative
  would leave a hidden entry on the site until tomorrow's run, which is a poor moderation tool and
  the sort of gap that gets reported as a bug.
- **The payload stays whole and the browser keeps filtering client-side.** It grows by roughly
  **1,000 entries a year** — ~670 venue and cruise records plus 365 daily `ArrivalsSummary` records —
  so it is small for years, and windowing it would break the client-side filtering, view switching
  and paging that #38–#40 already built and tested.
- **The daily run goes back to being purely a writer.** It scrapes and it upserts; it publishes
  nothing.
- **Raw `FlightArrival` rows are never served to the browser.** They have no `uid` and never render
  (`CONTEXT.md`); only the recomputed `ArrivalsSummary` reaches a reader.

### 5. Writes: one transaction per source, and the upsert touches only what was observed

**One transaction per source, not one per run.** A source that breaks mid-write rolls back its own
records and no others, which is the storage-level shape of ADR-0006's three outcomes and of
per-source Source health. A single run-wide transaction would let one broken adapter discard a
successful one's work.

**The upsert writes only the columns an adapter observed** — that is, exactly the fields of
`Scraped<T>`. It never writes `uid`, `sequence`, `firstSeenAt`, `hidden` or `reviewed`.

⚠️ **This is the one storage-shaped trap on the ticket.** A write path that touches `hidden` silently
un-does every judgement ever made, on the next run, with no error and no way to tell it happened.
ADR-0024 §4 makes it unwritable in the type; this makes it unwritable in SQL. Both, because the
failure is silent and permanent.

**Concurrency needs nothing invented.** Postgres readers do not block writers and writers do not
block readers; a moderator toggling `hidden` during a scrape and a scrape upserting a row the
moderator is looking at are ordinary concurrent transactions on different columns. No isolation level
above the default is required, and no application-level locking is.

### 6. `reviewed` — a second remembered boolean on `VenueEvent`

ADR-0024 left a gap that only shows up once the review queue has to be built. With `hidden` alone, a
**visible record is ambiguous**: it may be one nobody has looked at, or one that was looked at and
deliberately kept. The two are indistinguishable, so a cleanup list re-presents everything already
approved, forever — against a backfill of ~670 records and a daily refresh.

```
VenueEvent { …, hidden, reviewed }
```

| | |
|---|---|
| **Meaning** | A person has looked at this record. Not a verdict — `hidden` carries the verdict. |
| **Default** | `false`. A newly scraped record is unreviewed and visible (ADR-0024 §5 stands). |
| **Who sets it** | **Only a person**, for ADR-0024 §2's reason exactly: a machine-set flag would mean two things that cannot be told apart afterwards. |
| **Why / when / by whom** | **Not recorded**, consistent with ADR-0024 §3. |
| **Where** | **`VenueEvent` only** — for ADR-0024 §2's reasons unchanged. `PortCall` carries no relevance judgement, `ArrivalsSummary` is recomputed every run, `FlightArrival` never renders. |
| **`manual` records** | Arrive `reviewed: true`. A person typed it; there is nothing to review. |

It is **remembered state, not observed**, and joins the exclusion list:

```
Scraped<T> = Omit<T, 'uid' | 'sequence' | 'firstSeenAt' | 'lastSeenAt' | 'hidden' | 'reviewed'>
```

⚠️ **It carries `hidden`'s trap and needs `hidden`'s protection.** A scrape that cleared `reviewed`
would refill the queue with work already done — quieter than un-hiding, and equally silent.

**Hiding does not imply reviewing and reviewing does not imply hiding.** They are independent: the
queue reads `reviewed`, the calendar reads `hidden`. A record can be reviewed-and-kept (the common
case), reviewed-and-hidden, or unreviewed.

### 7. Migration: every record moves, and every UID moves with it

v1's `venue_event` and `port_call` rows are copied into Postgres **carrying their minted `uid`,
`sequence`, `firstSeenAt` and `lastSeenAt` unchanged.** Nothing is recomputed.

ADR-0004 is unambiguous — the UID is minted once on first sight and **never recomputed** — and it is
not theoretical here: `https://edw93d.github.io/20260716SingaporeTourismCalendar/feeds/venue-events.ics`
serves **200** today, on a **public** repository with **public** Pages. So a migration that re-mints
would replace every entry in anything currently subscribed.

Preserving the UIDs costs nothing — it is a column copy — and it is what makes v3 able to turn the
feeds back on without every subscriber's calendar being deleted and rebuilt.

⚠️ **The published `.ics` files stop being updated when the daily run stops publishing them.**
Whether the stale files are removed from Pages or left in place is a build-out detail, not a
decision here; either way nothing new reaches a v1 subscriber after the cutover.

### 8. Retention: the store deletes nothing, and there is nothing to age out of the served view

ADR-0004's *records are never hard-deleted* stands untouched, and now covers the raw
`FlightArrival` layer explicitly: **every raw flight row is kept forever.** #25 is the reason — the
top-three origin-country breakdown cannot be recomputed from a count, and a country question asked in
two years can only be answered from rows kept today.

At ~182k rows/yr on a narrow row, a decade of flights is roughly 250 MB and low single-digit millions
of rows. That is an unremarkable Postgres table.

**Nothing ages out of what is served**, because §3 removed the only surface where ageing out would
have been necessary. #18's escape hatch — cap the feed's backward horizon, keep the web whole — is
**not spent and remains available to v3**, which is where it will be needed.

### 9. No relations. `(source, sourceKey)` is still the whole of identity

The store gains **no** join table, **no** merge lineage, **no** cluster membership, and **no**
negative-ruling store. ADR-0024 removed all of them from the MVP, and #117's *relations the
same-entry ruling requires* bullet resolves to nothing.

Every record stands alone under `(source, sourceKey)`, holds its own `uid`, and renders as its own
entry. The schema is v1's two tables plus the flight tables plus two booleans — not a graph.

## Consequences

- ⚠️ **ADR-0010's zero-credentials property is spent.** v1 authenticated with `GITHUB_TOKEN` and
  nothing else; v2 holds a Postgres connection string. Map #20's constraint asked that any storage
  argument **price** this rather than skip it, so: **the property was already spent by map #112's
  settled *there is now a server*** — a server needs a credential to be reached and a place to run
  whichever store it talks to. What this ADR adds is one more secret of the same kind, not a change
  of kind. ADR-0010's actual rule — *network access is injected, never defaulted* — is a code-shape
  rule and is untouched; the store connection is injected exactly as the HTTP client is.
- ⚠️ **Git stops being the backup, and backup becomes a real requirement.** This is the cost that
  buys the rest, and it lands hardest on the flight rows, which cannot be re-scraped. Provider-managed
  point-in-time restore is the reason Postgres beat a file on a disk; **a host without it does not
  satisfy this ADR**, which is a constraint the deferred host question inherits.
- ✅ **The git-blob problem disappears entirely**, along with map #20's forecast pressure. The
  repository stops growing with the dataset.
- ⚠️ **A run's changes stop being legible in git.** ADR-0011's genuine win — *a reader of the history
  can answer "what changed in the calendar today?" without running anything* — is lost, and nothing
  replaces it. The `.ics` diff was the only human-readable record of a day's change, and it is not
  published any more. **This is the sharpest thing given up here.** No replacement is specified;
  if it is missed, the answer is a change log in the store, not a return to committing files.
- ✅ **#117's concurrency bullet costs nothing to satisfy.** It was the hardest question under a file
  and is a non-question under a service.
- **#118 is unblocked with a concrete target**: a server holding a connection string, one operator,
  no accounts on the store side.
- **#119 leaves this map's critical path** and rides to v3 with the feeds.
- **#120's queue has something to read.** `reviewed` is what makes the review list finite.
- **#121 and the adapter work are unaffected.** `Source`, `Scraped<T>`, `parse` and `sourceKey` do
  not change shape — the store is behind the pipeline, not in the adapter seam. The only change an
  adapter author sees is one more excluded field on `Scraped<T>`.
- ⚠️ **ADR-0021's stated premise is false today and this ADR only half-fixes it.** ADR-0021's
  barred-source position — and ADR-0024 §5's default-visible ruling, which rests on it — is argued
  from *"the repository is private, the calendar is personal… it reads and it stores, and it does not
  publish."* The repository is **public**, Pages is **public**, and the feed serves **200**. Retiring
  the feeds removes the republication of scraped facts in ICS form; **the public repository and the
  public site remain.** That is not #117's to rule on. Raised on map #112.
- **`src/store/store.ts` is rewritten and `better-sqlite3` leaves the dependency list.** The 253-line
  module's *shape* survives — one upsert path, minting and seen-tracking in the core, written once
  rather than once per type — which is what ADR-0005 asked of it. Its comment naming git-as-database
  as the reason for SQLite is the part that no longer describes anything.

### Reopen trigger

- **The write volume outgrows one daily run.** Nothing here assumes it will; per-source scheduling
  (#122) is where that would first show.
- **A second operator appears.** `reviewed` and `hidden` both record *that*, never *by whom*, on the
  same one-moderator assumption ADR-0024 §3 makes. Two moderators make both flags ambiguous at once.
- **v3's feeds land.** They bring back the retention question §3 removed, #18's backward-horizon
  hatch, and #119 — and they will meet a store that kept every UID for exactly that moment.

## Alternatives rejected

- **Keep committing SQLite to git.** Ed's own proposal mid-grilling — keep v1's store, prove the
  adapters, migrate later — and it survives right up to the point where v2's scope includes the admin
  page. Two writers cannot share a binary file in git at any volume, so this is not deferrable by
  scoping; it is the one part that had to be decided now.
- **SQLite on the server's disk, not in git.** The smallest change that fixes the git problem, and
  genuinely close. Rejected on §2: it forces the scrape onto the server and makes backup of
  unbackfillable data a manual duty.
- **Managed SQLite (Turso or similar).** Keeps the SQL dialect *and* lets both writers connect.
  Rejected as the worst of both — the driver layer is rewritten either way, which is most of the cost
  of moving to Postgres, in exchange for a smaller vendor and a narrower escape hatch.
- **Hold flights back and keep the file.** Would have deferred the volume pressure at no cost in lost
  history, since none exists yet. Rejected because the second writer, not the volume, is what breaks
  the file — and because v2's scope includes flights.
- **Keep publishing the feeds from the new store**, so nothing currently subscribed breaks.
  Rejected on Ed's v2/v3 split: it keeps a publishing path alive that v2 does not build, and keeps
  ADR-0021's publication problem fully live rather than half.
- **Start with an empty database and re-scrape.** Every venue and cruise record is re-scrapable, so
  nothing but the UIDs would be lost. Rejected because the UIDs are precisely what ADR-0004 says
  cannot be lost, and preserving them is a column copy.
- **Rebuild the site daily from Postgres, as v1 does.** Almost no new code, and the published
  artifact stays diffable. Rejected: a hide would take a day to take effect, which is a moderation
  tool that does not moderate.
- **Serve only the visible window to the browser** rather than the whole payload. Rejected as
  premature at ~1,000 entries a year, and it would break the client-side filtering already built.
- **One transaction per run.** Rejected: it lets one broken adapter roll back another's successful
  work, contradicting ADR-0006's per-source outcomes.
- **A `reviewedAt` instant, or a single "reviewed everything before this" bookmark**, instead of a
  per-record flag. The bookmark is smaller and never touched by a scrape, but it cannot represent
  skipping one record and returning to it. Rejected for that; the instant was rejected as ADR-0024
  §3 rejected `hiddenAt`.
- **No `reviewed` flag at all**, ordering the queue by `firstSeenAt` and using the date as a
  bookmark. ADR-0024 exactly as ruled, and no new state. Rejected: a record deliberately kept sits at
  the top of the list every day forever.
