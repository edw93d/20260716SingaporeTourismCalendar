# ADR-0019: `ArrivalsSummary` is an all-day record

- **Status:** Accepted
- **Date:** 2026-08-04
- **Ticket:** [#28](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/28)
- **Supersedes:** [ADR-0003](./0003-store-utc-instants.md), **in part** — its "no all-day
  shape, no `VALUE=DATE`" clause, and **only** for `ArrivalsSummary`.

## Context

ADR-0003 stored everything as UTC instants and removed the all-day shape entirely:

> **No all-day shape** and no `VALUE=DATE` — zero current sources need one.

It also named the condition under which that would be revisited:

> A future date-only source would need this reopened. None is in scope.

**#28 is that condition firing.** `ArrivalsSummary` (see `CONTEXT.md`) is one record per
calendar date carrying a day's arrival counts and the top three origin countries. It has
no clock time and cannot be given one: it is not a thing that happens at a moment, it is
a day's worth of things counted. This is not a source that *happens* to publish dates
without times — it is a record whose only temporal extent **is** the date.

Two shapes were available.

**Faking it with instants** — store `00:00`–`24:00` SGT and keep ADR-0003 untouched —
does not work. Asia/Singapore is +08:00, so a local midnight-to-midnight pair becomes
`16:00Z`–`16:00Z`, which calendar clients draw as a timed block straddling two dates
rather than a banner on one. It would honour the letter of ADR-0003 while producing the
wrong picture on screen, which is the worst of both.

## Decision

**`ArrivalsSummary` serializes as an all-day record.** `DTSTART;VALUE=DATE` with an
**RFC 5545 exclusive `DTEND`** — a summary for `2026-08-05` writes `DTEND;VALUE=DATE:20260806`.

The scope of this reversal is exact:

- **`VenueEvent` and `PortCall` are unchanged.** They remain UTC instants with no `+1`,
  for the reasons ADR-0003 gave — a hotelier staffing a shift needs `15:00–22:00`, and
  all three v1 sources publish true end times.
- **`ArrivalsSummary` has no instants at all.** It carries a `date`, not a `start`/`end`.
  There is no timed variant of this record and no discriminator on the existing two types.
- **`RRULE` stays banned.** Unchanged by this ADR. One summary per date is a discrete
  record, emitted once, not a daily recurrence rule — a rule would fabricate summaries
  for dates never scraped.

## Consequences

- **The `+1` returns, scoped.** ADR-0003 retired the inclusive-end-date rule as
  Ticketmaster-era debris. It comes back, but only inside the `ArrivalsSummary`
  serializer — the two instant-bearing types never touch it. The rule that was wrong was
  *"the serializer does `DTEND`'s +1"* applied globally; per-type it is simply RFC 5545.
- **The serializers now branch by type.** ADR-0003 rejected "support both timed and
  all-day" on the grounds that it bought a discriminator to serve zero sources. That
  arithmetic changes with a source that needs it: the branch is paid for once, by the
  type that requires it, rather than being carried speculatively.
- **The web calendar renders a banner, not a slot.** An `ArrivalsSummary` occupies the
  whole day row rather than a clock position — which is what it means.
- **One record still maps to exactly one VEVENT and one Excel row.** Excel stays
  un-foreclosed, as ADR-0003 intended.

## Alternatives rejected

- **Midnight-to-midnight UTC instants.** Keeps ADR-0003 intact on paper and renders
  wrong in practice (see Context). Storing a lie to preserve a rule is worse than
  reversing the rule in the open.
- **Reverse ADR-0003 wholesale.** Would reintroduce all-day handling for `VenueEvent` and
  `PortCall`, discarding real clock times from all three v1 sources to serve a fourth.
  ADR-0003's core argument survives untouched and is not up for review here.
- **Keep `ArrivalsSummary` off the feeds entirely** and render it only on the web
  calendar, dodging the serializer question. Rejected by #28: the feed set grows with
  types, and a subscriber choosing whether to take a daily banner is exactly what a
  separate feed is for.
