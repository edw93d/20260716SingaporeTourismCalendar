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
| Suntec | the `article.eventlist-event` container |
| SCC | the schedule `<table>` |
| MBCCS | the rendered grid |

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
