# ADR-0018: The week number is ISO-8601 — the only scheme a Monday-first grid can name its own rows by

- **Status:** Accepted
- **Date:** 2026-07-29
- **Ticket:** [#109](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/109)
- **Constrained by:** the Monday-first week (`mondayOf`) — this ADR does not reopen it, and explains below why the alternative would have had to.

## Context

Week's title read `27 Jul – 2 Aug 2026`. Demand planning talks in week numbers — *"let's
look at week 31"* — and a bare range gives a reader nothing to say. The title needed a
number.

"Week number" sounds like one thing and is not. Two knobs define it, and CLDR carries both
per territory:

| | week starts | days of the new year week 1 must hold |
| --- | --- | --- |
| **ISO-8601** | Monday | 4 (equivalently: week 1 holds the first Thursday) |
| **CLDR default** — `en-SG`, `en-US` | **Sunday** | 1 (week 1 holds 1 January) |

The second row is what Apple Calendar shows on a machine set to Singapore, and it
disagrees with the first at the year boundary. 28 December 2026 reads **week 53** under
ISO and **week 1** under `en-SG` — the discrepancy that opened the ticket.

## Decision

**The Week title carries the ISO-8601 week number of the row it names.**

The case is not that ISO is the better standard in the abstract. It is that ISO is the
only scheme that can name *this grid's rows*:

1. **An ISO week is a Monday-first week.** So an ISO week is exactly the row `weekDaysOf`
   draws, and `isoWeekOf` is a function of `mondayOf` alone — the same single fact the
   week views' geometry, the Monday-first weekday labels and the Date-spine's
   week-boundary line all read from. No second notion of where a week starts enters the
   model, which is the property that keeps the surfaces from ever disagreeing.
2. **The number is quotable.** It means the same thing to everyone who opens the page,
   which is the entire point of putting a number on a week.

`en-SG`'s rule fails (1) at the root and cannot be repaired by adjusting the anchor,
because its weeks run **Sunday–Saturday**. A row on this grid straddles *two* of them: the
row `27 Jul – 2 Aug 2026` overlaps `en-SG` weeks 31 (Sun 26 Jul – Sat 1 Aug) and 32
(Sun 2 Aug – Sat 8 Aug). There is no correct `en-SG` number to print on a Monday row —
only a number that is right for six of its seven days.

Two consequences are read as correct rather than suppressed:

```
Week 1,  29 Dec 2025 – 4 Jan 2026     ISO week 1 of 2026 opens in December 2025
Week 53, 28 Dec 2026 – 3 Jan 2027     2026 opens on a Thursday, so ISO gives it 53 weeks
```

**The week-year is left implicit.** `Week 1` beside a range, not `Week 1 of 2026`: the
dates sit on the same line and carry the year themselves, so qualifying every week to
disambiguate two of them taxes the 51 that were never ambiguous.

**Second, related change: the range prints both years when it straddles one.** The range
formatter had two branches, same-month and cross-month, and both printed only the closing
year — so those two weeks rendered `29 Dec – 4 Jan 2026`. That was always ambiguous and
never conspicuous; `Week 1` next to a range opening in December is the one moment a reader
has to be told *which* December. A third branch prints both years. This is a distinct
change from the number, recorded so it is not read as part of it.

## Consequences

- **The title disagrees with the reader's Mac twice a year.** On the two year-boundary
  weeks, a `en-SG` or `en-US` machine shows a different number beside the same dates.
  Accepted knowingly: the alternative is a number that disagrees with the grid it is
  printed on, which is worse, because the grid is the thing the reader is looking at.
- **`Week 53` is real and will surprise people.** 2026, 2032 and 2020 have 53 ISO weeks.
  It is not a stub or a rounding artefact — it is a full seven-day week — and nothing
  suppresses or merges it.
- **The number appears in the Week title only.** Month, Agenda and Date-spine page by the
  month and have no week to number; a test asserts their titles contain no `Week`.
- **Labelling the Date-spine's week-boundary line stays open.** It reads from the same
  `mondayOf` fact and could carry a number for free, which would make a long range
  scannable by week. Declined here rather than left unconsidered: that line is
  deliberately a *quiet* signal (§ Week-boundary line — 32% against 18%), and hanging text
  off it is a presentation decision in its own right, not a rider on this one.

## Alternatives rejected

- **CLDR's default rule with a Sunday-first grid** — i.e. match Apple Calendar exactly,
  numbers *and* spans. The only internally coherent way to match it, and rejected on cost
  rather than principle. It rewrites `mondayOf` and everything downstream: the weekday
  labels, the Date-spine boundary line, the paging step, the tests. The decisive cost is
  the **weekend wash**: Saturday and Sunday are the last two columns today and read as one
  block, and a Sunday-first grid splits them to opposite edges of the view. On a calendar
  whose subject is tourism demand, where the weekend *is* the demand unit, breaking the
  weekend in half to gain two boundary weeks of agreement with a desktop app is the wrong
  trade.
- **CLDR's anchor on a Monday grid** — keep the rows, number them from 1 January. The
  cheap hybrid, and incoherent: it matches no standard, and still disagrees with `en-SG`
  one week later, because the underlying weeks are different seven-day spans. It is also
  the mutation this decision is most exposed to, since the two anchors agree whenever
  1 January falls Monday–Thursday; `tests/calendar.test.ts` pins it on 2027, which opens
  on a Friday.
- **Follow the viewer's locale at runtime.** The same row would read `Week 53` or `Week 1`
  depending on who is looking, which destroys the number's only job — being quotable in a
  meeting — and is out under ADR-0009 (static-renderable).
- **A naive count from 1 January** (`floor(dayOfYear / 7) + 1`). Easier to explain, and
  buys that by producing a 1–3 day stub week and drifting from every other tool.
- **Qualify the week-year**, always (`Week 1 of 2026`) or only at the boundary. The first
  adds noise to 51 weeks to fix two; the second makes the title change shape
  unpredictably, which costs more attention than the ambiguity it removes.
