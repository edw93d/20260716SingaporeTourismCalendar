# ADR-0027: The source contract survives twenty sources — amended, not replaced

- **Status:** Accepted
- **Date:** 2026-08-06
- **Ticket:** [#121](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/121)

## Context

ADR-0005 fixed the ingestion seam against three sources: `fetch(deps) -> Raw` for all
the I/O, `parse(raw, now) -> ParseResult` pure, an explicit registry, and `FetchDeps`
carrying an injected `http` client plus an optional `browser` handed only to the adapter
that declares a need. It was designed so that "fetch a document and parse it" and "operate
a UI until it yields rows" fit the same interface without leaking which is which to callers.

The v2 acquisition survey (#113, #131, #25) has now put the concrete ~17-source list in
front of that interface. #121 asks whether `Source<T, Raw>` survives it, and if not, what
has to give. **Ed ruled the question against the concrete list, not an abstract twenty**
(05 Aug 2026): a seam is added only for a source that actually needs it, and a seam declined
is recorded as *not needed by the MVP* with the trigger that would reopen it.

## Decision

**`Source<T, Raw>` survives. It is amended, not extended and not replaced, and the three
existing adapters (Suntec, SCC, MBCCS) do not change.** The two amendments are small and
additive; everything else the survey raised was already absorbed, or is not needed by the
concrete list.

### 1. What the contract already absorbed, with no change

- **An API is not a special case.** SISTIC (#131 — 13 plain GETs, no browser, no parser)
  and Changi arrivals (#25 — an AppSync JSON endpoint) both landed as ordinary
  `fetch(deps) -> Raw`, `parse` pure. `Raw` being **opaque and adapter-owned** is exactly
  what let an API drop in beside an HTML scrape and a headless harvest without the interface
  learning a third mode. Paging, where a source has it, is navigation and lives inside
  `fetch` — the line ADR-0005's *Accepted limitations* already drew for MBCCS.
- **Multi-request acquisition fits.** A source needing one request per month or per day
  produces one `Raw` that happens to be an array. MBCCS already walks pagination inside
  `fetch`; Changi issues one GET per day. `fetch` returns whatever it gathered and `parse`
  maps it. No per-request shape is owed by the contract.
- **`sourceKey` stays opaque and adapter-owned** (ADR-0004). #121's duty here is the
  negative one handed to it by #115/#116: **do not make the key less opaque.** A core-owned
  key rule, a declared key *shape*, or a required native ID would each break the
  title + venue + year constraint that keeps 61 EventsEye soft-dated rows from re-keying
  into new records every time a date firms up. The contract keeps not asking.
- **Per-source failure isolation is already what the contract owes.** `parse` is pure, the
  run loop is **sequential** so one source's throw cannot take another's `lastSeenAt` down,
  and `run.outcomes` reports per source. Isolating sources into separate processes or jobs
  is a *scheduling* property, not a contract one, and rides with **#122**.

### 2. Credentials — not needed by the concrete list

`FetchDeps` grows **no** secret. No source on the list needs one to `fetch`: MBCCS runs
without any (its leaked credential is permanently banned, ADR-0005 §5), SISTIC is genuinely
unauthenticated (#131 — the server ignores the bundle's token), Eventbrite and Ticketmaster
ban scraping by name and are never built, and every other source is open HTTP or a browser
page served to the anonymous public. The credentials ADR-0026 spent — the store connection
string and the admin login — are **server-side**, not adapter-side, and do not touch this
seam.

*Reopen trigger:* the first source on the list that authenticates a fetch. ADR-0021 §4.2
bars reading behind an authentication wall anyway, so a source that needs a credential to
be read is a legal decision (§4) before it is a contract one.

### 3. Incremental acquisition — not needed by the concrete list

`fetch` **stays blind to the store.** v1 re-reads every source whole each run, and nothing
on the list needs to ask "what did I see last time?" The only high-volume source, Changi
arrivals, reads a **fixed one-month-forward window** each run (#28 — ~15k rows, a product
choice where D+363 was available); the store accumulates landed history through upsert, not
through an adapter that reads its own past. Giving `fetch` a view of the store would be a new
dependency added for no source that has it.

*Reopen trigger:* a source whose window is too large to re-read whole, or one that only
serves a since-cursor.

### 4. The User-Agent stays one core-owned constant — no per-source override

#135 found that Marina Bay Sands refuses any User-Agent whose comment field carries a
**hostname-shaped token or whitespace**, whatever it claims to be, but **serves** the
scheme-less form `Mozilla/5.0 (compatible; sg-tourism-calendar/0.1; +edw93d/20260716SingaporeTourismCalendar)`.
SISTIC and every other tested source serve that same form. **One string satisfies the whole
list**, so the contract grows no per-source User-Agent seam: the User-Agent remains a single
constant owned by `src/pipeline/http.ts` (and the browser route, ADR-0021 §2 / ADR-0005
Amendment 4). A WAF does not earn a seam that one well-chosen constant makes unnecessary.

This resolves the reading ADR-0021 §4's #135 amendment left owner-held. **ADR-0021 §2.1 is
loosened:** a scheme-less `owner/repo` identifier discharges its *"linking the repository"*
obligation. The obligation's purpose is that a human reading a server log can find who is
reading them and how to object; `edw93d/20260716SingaporeTourismCalendar` does that
unambiguously. The literal-URL reading is not only unnecessary but self-defeating here — the
resolvable URL is precisely what the source refuses, so insisting on it would drop a source
that is otherwise served politely and honestly. §2.1's *"never a browser string"* is
untouched and still binds: the served form declares itself a bot by name and impersonates
nothing.

### 5. Hand-entry (`manual`) lives outside the `Source` contract

ADR-0024 admits hand-typed events as a source named `manual`. It is **not** a `Source`: it
does not appear in the `sources` registry array, and it implements neither `fetch` nor
`parse`. It is a write path from the admin page straight into the store, sharing only the
universal `(source, sourceKey)` identity — `sourceKey` minted by the admin page, `lastSeenAt`
frozen at entry, exempt from Source health by name (ADR-0024, `CONTEXT.md` § Source health).

The registry means *what the pipeline goes and reads*; `manual` is never read, so it does not
belong in that array, and forcing it to implement the interface would add two members that
can only throw — an interface that lies about what it does. Identity universality is preserved
without that: `(source, sourceKey)` lives in the **store schema**, not in the `Source` TS
interface, so every record still carries one whether or not an adapter produced it.

## Consequences

- **Amends [ADR-0005](0005-source-adapter-interface.md)** (Amendment 5): the one-core-UA
  ruling and the `manual`-outside-the-contract ruling. `Source<T, Raw>`, `FetchDeps`,
  `HttpClient`, `BrowserSession` and the registry array are unchanged in shape.
- **Amends [ADR-0021](0021-reading-sources-that-forbid-it.md) §2.1** — a scheme-less
  `owner/repo` identifier discharges *linking*. Resolves the reading §4's #135 amendment left
  owner-held.
- **Confirms [ADR-0004](0004-opaque-source-key-and-seen-tracking.md) and
  [ADR-0024](0024-moderation-is-one-flag-and-the-mvp-does-not-match.md)**: the opaque key and
  the `manual` identity rule stand exactly as written.
- **Unblocks [#124](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/124)**
  (breakage detection at small sources), which was blocked by this ruling.
- **`/to-spec` reads this as: the ingestion seam is settled.** The build folds in each
  adapter (#126-style implementation tickets) against an unchanged interface, plus the
  `manual` write path as a store operation, not an adapter.

## Accepted limitations

- **Two seams are declined, not proven impossible** — credentials (§2) and store-aware
  incremental fetch (§3). Each is recorded with the trigger that reopens it. A source arriving
  with either forces a fresh ADR, not a silent addition.
- **The one-core-UA constant is chosen against today's list.** A future source that refuses
  the scheme-less `owner/repo` form *and* every form another source requires would force the
  per-source seam §4 declines. No source on the list does; #135's matrix is the evidence.

## Alternatives rejected

- **Per-source User-Agent override** — a real seam the contract lacks today, justified only if
  no single string satisfied every source. #135 + #131 show one does. Rejected as design cost
  bought for nothing.
- **`manual` as a stubbed `Source`** — keeps every record "coming from a `Source`" uniformly,
  at the cost of an interface whose `fetch`/`parse` throw. Rejected: identity universality
  lives in the store, not the interface, so uniformity is already had without making two
  methods lie.
- **Adding a secrets member to `FetchDeps` speculatively** — rejected under the concrete-list
  scope: no adapter reads it, and an unused injected dependency is the kind of politeness-
  posture erosion ADR-0005 built the seam to prevent.
