# ADR-0015: The Date-spine bar is two lines — a third narrowing of "every entry is labelled with the source"

- **Status:** Superseded in part by [ADR-0016](./0016-the-date-spine-bar-is-the-name-alone.md)
  — its **Decision** only. The bar draws the **name alone**, not two lines led by the
  duration: on a one-date bar there was only ever room for one line, and this gave it to
  the wrong field. Everything below about the geometry — why the row height cannot grow,
  why the spine rounds to whole day rows, why both hairline insets are load-bearing —
  still holds and 0016 rests on it.
- **Date:** 2026-07-28
- **Ticket:** [#98](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/98)
- **Narrows:** #38 ("every entry is labelled with the source"), for the third time — after
  the **Month** chip (#80) and Week's **all-day band** (#81), both already recorded in
  `CONTEXT.md`.
- **Constrained by:** ADR-0009 §3 (Date-spine makes duration literal — a bar's height
  *is* its duration).

## Context

Date-spine drew its bar with `renderEntry`, the shared four-line reading-surface entry:
duration, name, location, source, styled by `.calendar__entry` at `0.8rem/1.3` with
`0.25rem` of padding.

That does not fit, and the arithmetic is not close. A bar spanning one date is one
`--spine-row` tall less the hairline inset — `28 − 2 = 26px` — of which padding takes
8px, leaving **18px of content box**. The duration line consumes it. Every single-date
entry therefore rendered as a bare duration label with its name clipped away entirely
(#98), which is most of the month: the view answered "how long" and never "what".

The row height is not available to fix this. ADR-0009 §3 makes a bar's height *its
duration* — that is the view's entire proposition, and the one place in the product
where magnitude is read structurally rather than scored (ADR-0009 §5). Growing
`--spine-row` to ~64px to fit four lines would push July's track past 1,900px and
destroy the at-a-glance comparison the spine exists for.

So the constraint is fixed and the content must give. The question is only **which
fields**.

## Decision

**The Date-spine bar draws two lines — the duration, then the name — at the spine's own
type scale (`0.72rem/1.2`, `0.1rem 0.3rem` of padding).** The location and the source
come off the bar, and a port call's `Cruise: ` prefix with them.

This is a **third narrowing of #38's "every entry is labelled with the source."** The
attribution is not lost: it is on the bar's `title`, and in the entry-detail bubble a
double-click opens (#75). The narrowing is the same one, for the same reason, that
`CONTEXT.md` already records for the **Month** chip — a surface whose own geometry
decides how much text there is room for drops what will not fit, and names where the
reader can get it.

The `Cruise: ` prefix goes for the chip's reason too: on a bar this narrow it is eight
characters of constant crowding out the `vessel`, which is the only thing telling one
call from another. ADR-0001 keeps that prose inside `summary` because an iCal client has
nothing else to carry the category; the bar has its colour.

Two second-order points that follow, recorded so they are not "tidied" later:

1. **Length stays on the bar as words.** The height says *which dates*; the label says
   *how long*. That split is what lets the geometry round to whole day rows — the
   alternative, a bar drawn to the clock, makes a six-hour entry a sliver too small to
   name, starting part-way down a row it lines up with nothing on (#97).
2. **The bar is inset by a hairline on all four edges, and both insets are
   load-bearing.** Without the vertical one, consecutive days in one lane paint flush
   and read as one long entry. Without the horizontal one, so do two neighbouring
   lanes — which is how a cruise arrival and a venue event came to share an edge with
   no gutter between them (#98). The insets live in the stylesheet and the renderer
   publishes clean percentages, extending #97's rule to the second axis.

## Consequences

- **A third builder.** `renderSpineBar` joins `renderLeaf` (one line) and `renderEntry`
  (four). `bindBubble`'s contract — "the functions every view draws an entry through" —
  now names three, which is still how the `+N more` doors stay excluded without a rule
  saying so.
- **`CONTEXT.md` gains **Bar** as a term**, and its **Chip** entry now names *two*
  exceptions to "the reading surfaces draw the same entry in full" rather than one.
- **Descenders on the second line are clipped** on a one-date bar: 27.6px of text in a
  22.8px box. Accepted, not overlooked — it is the floor the duration-is-height
  constraint imposes, and the prototype this is drawn from has it too. Reversing it
  means reversing ADR-0009 §3.
- **The accepted cruise-magnitude hole (ADR-0009 Consequences) is unchanged.** The bar
  still cannot tell a 3 hr fair from a 20 hr port call by height alone; the label does.

## Alternatives rejected

- **Raise `--spine-row` to fit the four-line entry.** Rejected: it contradicts ADR-0009
  §3 by making the row height a function of the text rather than of the duration, and
  costs the whole view's legibility to buy one line already reachable in one gesture.
- **Keep all four lines and let them clip.** This was the status quo, and it is what
  #98 reports: it does not degrade gracefully, it deletes the name — the single most
  useful field — while keeping the two least useful on a surface this narrow.
- **Show two lines on one-date bars and four on multi-day ones.** Rejected: the same
  entry would render differently on the same surface depending on its length, so a
  reader could not learn what a bar tells them. The reading surfaces' value is that an
  entry looks like itself.
- **Give `renderLeaf` an optional lead label instead of a third builder.** The lead line
  has to be classed to be dimmed, which forces a shared builder to either name one
  surface's class or take it as a fourth parameter. Three lines of repeated preamble is
  the better trade.
- **Restate the type colours in a standalone `.spine__bar` block**, as the prototype
  does. Rejected: a second copy of `#2563eb` / `#0d9488` is how "the type is one colour
  wherever it renders" quietly stops being true. The bar joins the existing shared
  `[data-type]` selector instead.
