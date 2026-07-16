# ADR-0002: No scraped description; the iCal DESCRIPTION slot is generated

- **Status:** Accepted
- **Date:** 2026-07-16
- **Ticket:** [#7](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/7)
- **Resolves:** the map's contested `description` constraint

## Context

`description` was inherited from the manual Excel's columns, then contested by the
legal audit (#3): a scraped marketing blurb is copyrightable **expression**, not fact,
which collides head-on with the facts-only constraint the entire legal position rests on.

Two findings collapsed the question:

- **It is barely there.** ~8% populated on Suntec (13/154), and **absent entirely**
  from MBCCS and SCC (#2).
- **ADR-0001 removed it from `PortCall` outright.** A port call has no description at
  source, so the field was Suntec-only before the legal question was even reached.

Meanwhile the output-format audit (#6) found the iCal **`DESCRIPTION` property** is one
of only seven that survive all three major clients — and, with `CATEGORIES` and `URL`
dropped by 2 of 3, one of only two places attribution can travel at all.

So `description` was two different things wearing one name: a **scraped field** and an
**output slot**.

## Decision

Separate them. The scraped field dies; the output slot is generated.

- **No `description` field on `VenueEvent` or `PortCall`.** The Suntec blurb is not
  extracted, not stored, not published.
- **`CalendarEntry.description` is composed by us** from facts we hold — source
  attribution, category, and berth for port calls.

```
"MICE event at Suntec Convention Centre. Source: suntecsingapore.com"
"Berth 2. Source: mbccs.com.sg"
```

## Consequences

- **Facts-only now holds with zero exceptions.** It was the only extraction that
  reached past fact into expression.
- The field goes from 8%-populated-and-legally-contested to **100%-populated and ours**.
- Attribution still travels, in the one slot that survives every client.
- The map's `description` constraint is **resolved**, not merely deferred.
- 13 Suntec events are less rich than they could be. Accepted.

## Alternatives rejected

- **Keep scraped, append attribution.** Richer for 13 of 154 events, at the cost of
  knowingly republishing copyrightable expression — trading the legal position for
  8% coverage of one source.
- **Store but never publish.** Worst of both: copying is the act copyright regulates,
  so the risk is retained while the benefit is deferred indefinitely.

## Revisit if

The product moves beyond existence + timing, or a source grants a licence. Either
requires a fresh legal read regardless.
