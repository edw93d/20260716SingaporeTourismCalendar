# ADR-0005: The source adapter interface — split fetch/parse, injected I/O, explicit registry

- **Status:** Accepted
- **Date:** 2026-07-16
- **Ticket:** [#8](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/8)

## Context

Every source is a scrape (#4: no licensed feed exists; STB's TIH is dead), and a new
source is a new module in code (standing constraint). This ADR fixes the seam that
ingestion hangs off.

The three sources are radically unlike each other:

| Source | Acquisition | Shape |
|---|---|---|
| Suntec | one server-rendered GET, 154 events | parse Google Calendar export links |
| SCC | one server-rendered GET, 16 rows | walk an HTML `<table>` |
| MBCCS | **headless browser, mandatory** (#16 removed the fallback) | drive a date filter + pagination, read the rendered grid |

Two are "fetch a document, parse it." One is "operate a UI until it yields rows." The
interface must fit both **without leaking which is which to callers**, and must scope
headless to the one adapter that needs it.

## Decision

```ts
// Observation, not memory. See CONTEXT.md § Scraped.
type Scraped<T> = Omit<T, 'uid' | 'sequence' | 'firstSeenAt' | 'lastSeenAt'>

type FetchDeps = {
  http: HttpClient          // UA, per-host rate limit, timeout, retry already baked in
  browser?: BrowserSession  // injected ONLY into adapters that declare a need
  now: () => Date
}

interface Source<T, Raw = unknown> {
  readonly key: string                                  // 'suntec' | 'scc' | 'mbccs'
  fetch(deps: FetchDeps): Promise<Raw>                  // all the I/O
  parse(raw: Raw, now: Date): ParseResult<Scraped<T>>   // pure
}

// Explicit. One file answers "what feeds this calendar?"
const sources: (Source<VenueEvent> | Source<PortCall>)[] = [suntec, scc, mbccs]
```

**1. One generic interface, `Source<T>`, not two interfaces and not a union.** #7's
two-types ruling was about *records* — cruise feeds publish no name, so a shared schema
fabricated one. That argument does not transfer to the *process*: fetch → parse → upsert
by `(source, sourceKey)` → advance `lastSeenAt` is identical across all three, and touches
only the fields both types genuinely share. The type parameter keeps #7's honesty without
writing the pipeline twice.

**2. `fetch` and `parse` are split; `Raw` is opaque and adapter-owned.** The core passes
`Raw` from one to the other without inspecting it — the same move ADR-0004 made for
`sourceKey`, for the same reason: the sources disagree on what raw material even is (one
document, one document, N rendered pages). This is what seals the headless leak *at the
type level* rather than by convention: `Raw` means "the bytes, however they were obtained,"
and a caller cannot tell that MBCCS drove Chrome for three seconds while Suntec spent 200ms
on a GET.

**3. The core injects I/O; adapters never construct it.** Adapters own what is true about
the source (URLs, selectors, parse rules, `sourceKey` computation — honouring ADR-0004's
promise that `sourceKey` is part of this contract). The core owns policy (UA, rate limit,
retries, timeouts, clock, browser lifecycle).

**4. Registration is an explicit array.** No filesystem discovery, no self-registration.

**5. There is no config system.** Selectors and URLs are constants in the module. v1 has
**no credentials at all** — a clean consequence of the no-granted-access constraint (#16),
with the MBCCS leaked credentials permanently banned.

## Consequences

- **Each source gets a wholly unique scraper.** The three implementations share no
  *source knowledge* — selectors, URLs, parse rules, `sourceKey` computation; the
  interface constrains only the edges. This is what the seam *buys*, not what it costs.
  See **Amendment 1** for the boundary between source knowledge and HTML primitives.
- **#9 (breakage detection) gets a usable seam.** A pure `parse` over stored bytes means
  yesterday's fixture can be replayed against today's parser — so breakage can be
  attributed to *which side moved*. Unified fetch+parse would make those inseparable.
- **Politeness is structural, not disciplinary.** An adapter has no route to the network
  except a client that already rate-limits, so the well-behaved-reader posture that #3's
  facts-only legal position rests on cannot quietly lapse when a future source is added
  in a hurry.
- **Headless is scoped by construction.** Suntec cannot acquire a browser; it isn't on its
  `deps`. Enforced by the type, not by a note in a doc.
- **Fixture tests are the primary test asset.** All real logic (gcal extraction, SGT
  parsing, UTC conversion, `sourceKey`) sits in `parse` and needs no network.
  **Fixtures are real bytes the source served, trimmed to the region under test and
  otherwise verbatim** — each carrying a header comment with its URL and fetch date.
  A hand-written fixture asserts the page behaves as its author imagined and keeps
  passing while the real page moves on, which is the same objection that rejects
  unified `scrape()` below. Trimming is allowed because it removes bytes; editing
  them is what manufactures the fiction.
- **`now` is injected** so fixture tests don't drift as fixtures age past the ~3-month window.
- Adding a source touches two files (module + registry). That is the point, not overhead.

### Accepted limitations

- **A source needing genuine fetch/parse interleaving would fight this split** — where a
  token must be extracted from page 1 to fetch page 2. MBCCS brushes against it already;
  the line held is that **navigation** logic ("is there a next page") stays inside `fetch`,
  while **extraction** logic stays pure in `parse`. If real interleaving arrives, fold the
  loop inside `fetch`. Revisit only if that becomes untenable.
- **`Raw` as a type parameter** adds a generic the core carries but never uses. Accepted as
  the price of not holding an opinion the sources don't share.

## Alternatives rejected

- **Unified `scrape(deps)`** — one method, nominally deeper. Rejected because testing a
  parser then means faking what it fetches from, and for MBCCS that fake is a *browser
  session* (date filter, pagination, hydration wait). Elaborate, and fiction: it would
  assert the page behaves as imagined and pass while the real page moved on. The one source
  with **no fallback** would get the least trustworthy tests.
- **Two interfaces** (`VenueEventSource` / `PortCallSource`) — honest to #7, but the
  pipeline is identical, so it duplicates or generifies back to `Source<T>` with extra steps.
- **One interface returning `(VenueEvent | PortCall)[]`** — no adapter is polymorphic in
  practice; every consumer pays a discriminant check for flexibility nothing uses.
- **Adapters construct their own clients** — rate limiting becomes something each future
  author must *remember*, with no test asserting politeness when they don't.
- **Filesystem discovery / self-registration** — fails the deletion test: nothing of value
  is lost, it only saves typing the line that should be typed. Degrades typing to `any` at
  the glob boundary, discarding the type parameter chosen above. And disabling a source —
  a live risk, since SCC's Imperva is passive but one switch-flip from defending — stops
  being a one-line revertable diff and becomes an `enabled: false` flag, reintroducing the
  config system through the side door.
- **A config file for selectors** — foreclosed by the standing constraint; extraction is code.

## Amendments

### Amendment 1: "share no code" means share no *source knowledge*

- **Date:** 2026-07-20
- **Ticket:** [#36](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/36)

The original consequence read "the three implementations share no code," which the SCC
adapter took literally: `ENTITIES`, `decodeEntities` and `textOf` were copied from Suntec
verbatim, comment included. With two copies they had **already diverged** — Suntec's
entity table carries `hellip`, SCC's did not, and the same `apos` value was spelled two
different ways. MBCCS would have made three.

The line this ADR was actually drawing is around **source knowledge**: what is true about
one page — its URLs, its selectors, its parse rules, how it computes `sourceKey`. Sharing
those is what produces the coupling this ADR rejects, where a Suntec redesign edits a file
SCC depends on. An HTML entity table is not knowledge about SCC; `&amp;` decodes the same
in every document on the web. Copying it buys no decoupling and costs silent drift, which
is the opposite of the trade this ADR made.

**Decided:** generic HTML primitives that hold no opinion about any source may live in one
shared module (`src/sources/html.ts`). Anything naming a source, a URL, a selector, or a
field stays in its adapter. The test is whether the code would read identically if written
for a page nobody has seen — entity decoding would; `cell(row, "CRUISE SHIP")` would not.

Rationale a reader will want and the diff will not give: `textOf`'s *docstrings* stayed in
the adapters, because why SCC strips tags (a cruise line's `<img>` logo would otherwise weld
itself into `vessel`, and from there into `sourceKey`) is source knowledge, even though the
function that does it is not.
