# ADR-0003: Store UTC instants; retire the inclusive-end-date rule

- **Status:** Accepted
- **Date:** 2026-07-16
- **Ticket:** [#7](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/7)
- **Amends:** the map's "store inclusive end dates; serializer does `DTEND`'s +1" note

## Context

The map recorded: *"Store inclusive end dates; no `RRULE` in v1. The serializer does
`DTEND`'s +1."*

That rule only makes sense for **all-day** events (`DTSTART;VALUE=DATE`), where RFC 5545
requires an exclusive `DTEND`. It was written when **Ticketmaster SG** was still a
seed source — the one source that published dates without times (#2 flagged that if
Ticketmaster stayed in scope, the model would need an explicit all-day shape).

**Ticketmaster was then dropped by the legal audit (#3), and the rule was not revisited.**
All three surviving sources publish true end times:

| Source | End time |
|---|---|
| Suntec | **154/154** — full UTC interval in the gcal export link |
| MBCCS | `unberthingDateTime` |
| SCC | departure column |

Storing dates and +1-ing them would therefore **discard real clock times that every
remaining source hands us** — to serve a source that no longer exists.

## Decision

`start` / `end` / `arrival` / `departure` are **UTC instants**.

- `DTSTART` / `DTEND` serialize the true instants. RFC-exclusive `DTEND` is naturally
  correct for a timed event, so there is **no +1**.
- **No all-day shape** and no `VALUE=DATE` — zero current sources need one.
- **No `RRULE`** in v1 (unchanged): sources emit discrete one-offs, so one record =
  one VEVENT = one Excel row.

Suntec already emits UTC. MBCCS and SCC emit local SGT, which converts losslessly:
Asia/Singapore is fixed **+08:00 with no DST since 1982**, so `VTIMEZONE` is a static
literal and no timezone library is needed at serialization.

## Consequences

- A hotelier staffing a shift sees `15:00–22:00`, not "all day" — the difference the
  audience is buying.
- One record still maps to exactly one VEVENT and one Excel row, so Excel stays
  un-foreclosed at no cost.
- A future date-only source would need this reopened. None is in scope.

## Alternatives rejected

- **Keep inclusive dates as written.** Consistent with the recorded note, but throws
  away 154/154 real Suntec times to honour a rule whose only justification was dropped.
- **Support both timed and all-day.** A discriminator in the schema and in every
  serializer, to serve zero current sources.
