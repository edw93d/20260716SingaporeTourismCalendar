# ADR-0006: Parse reports three outcomes, because zero rows is ambiguous

- **Status:** Accepted
- **Date:** 2026-07-16
- **Ticket:** [#8](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/8)

## Context

ADR-0004 made a careful promise: a record's absence from a scrape is **never** resolved
into a status. The source never said whether it was cancelled, rescheduled, or scrolled
past the ~3-month window, so the model records the observation and refuses to infer.

That promise is only as good as the scraper's honesty about its own failures.

Two ways a scrape goes quiet without saying so:

1. **A row fails to parse.** Suntec is 154/154 well-formed today; that is an observation,
   not a guarantee.
2. **The whole document isn't ours.** SCC sits behind Imperva, currently passive, and #2
   flagged it as *"a live switch the operator can flip at any time"* — the source most
   likely to start defending. A challenge page returns **HTTP 200**. `fetch` is satisfied;
   it got bytes.

## Decision

```ts
type ParseFailure = {
  sourceKey?: string   // if extraction got that far
  fragment: string     // the raw material that failed
  expected: string     // what the parser was looking for
}

type ParseResult<T> =
  | { ok: true;  records: T[]; failures: ParseFailure[] }
  | { ok: false; reason: string }
```

**1. Partial success is first-class.** `parse` returns good records *and* structured
failures. Good records still land; failures still surface.

**2. Silently dropping a bad row is forbidden.** Not stylistically — it corrupts the
domain model. A dropped row stops appearing, `lastSeenAt` stops advancing, and it becomes
**indistinguishable from a genuine absence**. That launders a scraper defect into what
looks like a domain observation, in the exact part of the model ADR-0004 built to never
guess. #9, reading downstream, would faithfully report the source changed when in fact we
broke.

**3. Each parser declares a structural anchor**, checked *before* any row is examined:

| Source | Anchor |
|---|---|
| Suntec | the `div.eventlist` listing container |
| SCC | the schedule `<table>` |
| MBCCS | the rendered grid |

**The anchor is the listing container, never a row.** This table first named Suntec's
anchor as `article.eventlist-event` — a row element — and that was an error, corrected on
2026-07-20 during #34. A row selector cannot satisfy the two bullets immediately below,
because *empty listing* and *not our document* both yield zero rows and would be
indistinguishable. Only a container that the CMS renders whether or not it has contents
can carry the distinction, which is the whole point of the anchor.

- **Anchor present, no rows** → `ok: true, records: []`. The source is genuinely empty.
  A fact. (MBCCS renders *"There are no scheduled cruises"* as a valid state; SCC's 16-row
  table can legitimately have a quiet week.)
- **Anchor absent** → `ok: false`. We are not looking at our document: a challenge page,
  a redesign, an error served with a 200.

## Consequences

- **#9 gets three distinguishable signals instead of one silence**: source is empty, some
  rows broke, the page isn't ours. Without the anchor, #9 would have to infer breakage from
  a row count — guesswork dressed as monitoring.
- **The SCC WAF flip is detected the morning it happens**, rather than presenting as a
  cruise terminal that mysteriously stopped receiving ships.
- **Failures are debuggable without re-scraping** — the fragment travels with the failure.
- Every caller handles the `ok: false` arm. There is exactly one caller (the pipeline), so
  the cost is close to zero.

## Alternatives rejected

- **Throw on any bad row** — one malformed gcal link out of 154 discards a whole day's
  Suntec scrape, and `lastSeenAt` stalls on 153 healthy records, faking 153 absences.
- **Silently drop bad rows** — see Decision 2. Manufactures fake absences in the one place
  the model promised not to guess.
- **`{ records, failures }` with no `ok: false` arm** — leaves zero-rows ambiguous, which
  is the failure this ADR exists to prevent. A WAF challenge page and an empty week would
  return byte-for-byte identical results.
- **Let #9 infer breakage from row counts** — cannot distinguish "source published nothing"
  from "the selector died." That distinction is only cheaply available *inside* the parser,
  which is the only code that knows what the document should look like.

## Amendments

### Amendment 1: MBCCS's anchor is a well-formed schedule payload, not the rendered grid

- **Date:** 2026-07-21
- **Ticket:** [#37](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/37)

The anchor table above names MBCCS's anchor as "the rendered grid," and #37 repeats it. That
was written before the page was built against. The MBCCS grid is Tailwind utility-class
`<div>`s with no id and no stable class; its stable data lives only in React state, so `fetch`
harvests that state and hands `parse` a JSON payload rather than markup (ADR-0005, Amendment 2).
The anchor moves with the raw material.

**MBCCS's anchor is a well-formed schedule payload** — `fetch` returning an *array* of schedule
records (each an object shaped like the schedule, whatever its length). It plays the exact role
this ADR demands of an anchor, only in JSON:

- **Payload present, no records** → `ok: true, records: []`. MBCCS renders *"There are no
  scheduled cruises"* as a genuine empty state, and `fetch` harvests that as an empty array. A
  quiet window is a fact about the source.
- **Payload absent** (`fetch` could not locate the schedule state — the app did not hydrate, a
  redesign moved it, or the page served is not ours) → `ok: false`. This is the JSON equivalent
  of SCC's missing `<table>`: proof we are not looking at the document we think we are, kept
  distinct from a genuinely empty week. The contract with `fetch` is precise for this reason —
  it returns an empty array for the empty state and a null/absent payload *only* when the
  schedule state cannot be found at all.

The principle is unchanged from the Decision above: the anchor is the container the source
renders whether or not it has contents, checked before any record is examined, because *empty*
and *not our document* both yield zero records and only the anchor tells them apart. The
container is a JSON array here instead of a `<table>`; the reasoning is identical.
