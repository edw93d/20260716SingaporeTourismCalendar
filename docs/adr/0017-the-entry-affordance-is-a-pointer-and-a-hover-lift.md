# ADR-0017: The entry affordance is a pointer cursor and a hover lift — a signal that under-describes its gesture, knowingly

- **Status:** Accepted
- **Date:** 2026-07-29
- **Ticket:** [#105](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/105)
- **Constrained by:** the double-click gesture (#75) — this ADR does not reopen it.

## Context

Every entry on every surface opens the **Entry-detail bubble** on a double-click. None of
them said so. `.calendar__chip`, `.calendar__entry`, `.week__band` and `.spine__bar`
carried no `cursor` rule, so each inherited the default `text` I-beam and hovered like
prose — while the `+N more` door sitting in the same cell already carried
`cursor: pointer`. The grid advertised its one navigational control and stayed silent
about the eighty-eight entries around it.

The awkward part is that **CSS has no cursor for "double-click me."** Whatever shape goes
here is a lie or an understatement about the gesture behind it. That is the whole of the
decision; the CSS is trivial.

The gesture itself was reconsidered and left alone. `bindBubble`'s comment records why it
is `dblclick` — a single click is how a reader scans a chip-dense Month, and a popover
under every one of them would make the navigator unusable — and nothing here disturbs
that reasoning.

## Decision

**Every node `bindBubble` reaches gets `cursor: pointer` and a hover lift; nothing else
does.**

Three things follow, decided rather than defaulted:

1. **`pointer`, accepted as an under-description.** The hand conventionally promises that
   *one* click does something, and one click here does nothing. Taken knowingly, because
   the failure is self-correcting and the correction is the teaching: a reader who clicks
   once and sees nothing clicks again, and the second click is the gesture. No other
   shape both signals "interactive" and survives being the only signal on a 0.72rem chip.
2. **The affordance follows the binding.** The selector list is exactly the four classes
   drawn through `renderLeaf`, `renderEntry` and `renderSpineBar`. This is the rule, not
   the current inventory: a fifth entry surface inherits the binding and the affordance
   together, or neither. The `+N more` doors are excluded by the same fact that excludes
   them from the binding — a door navigates rather than describing an entry, so it is
   none of the three. Week's door needs subtracting by name (`week__band week__band--more`
   is a modifier *on* the band); Month's does not.
3. **The lift is one inset wash, behind `hover: hover`.** `box-shadow: inset 0 0 0 999px`
   in a `canvastext` mix lays a wash *over* whatever colour the node already carries, so
   the VenueEvent blue, the PortCall teal and the untyped grey lift by the same amount
   from one rule and it flips correctly in dark mode — where three background rules would
   have needed hand-tuning per type and per scheme. The `hover: hover` guard exists
   because a `:hover` on a touch device sticks after the tap, leaving an entry lifted
   until something else is tapped: a selected state this calendar does not have. `cursor`
   needs no guard, being simply inert where there is no pointer.

## Consequences

- **The lift, not the cursor, does the work.** A 16px shape in the corner of the reader's
  attention was never going to carry this on its own — which is why the cursor-only
  variant was rejected at the prototype (below). The cursor confirms what the lift has
  already suggested.
- **One click on an entry is now a visible non-response.** Before, the I-beam promised
  nothing and delivered nothing; now the hand promises and the first click withholds.
  This is a real cost and the reason the alternatives below were weighed at all. It is
  paid once per reader.
- **Touch gets the cursor's nothing and none of the lift.** A touch reader's only route
  to the bubble remains the double-tap, which many mobile browsers spend on zoom instead.
  That gap is inherited from #75, not opened here, and is deliberately not addressed.
- **The bubble still has no keyboard opening.** Unchanged, and untouched: making the
  entries focusable would put 88 tab stops in a Month, which is its own decision and not
  this one.
- **`.week__band` takes the lift in a 1.35rem lane** — the tightest box the rule lands
  on. Checked against the live payload before merge rather than exempted on suspicion;
  the wash fills the lane cleanly.

## Alternatives rejected

- **`cursor: zoom-in`.** The strongest runner-up, and prototyped side by side. It is more
  *honest* — it says "there is more detail in here", which is what the bubble is, and it
  promises no particular click count, so the silent first click costs it nothing.
  Rejected because honesty was not the failing: the entry needed to read as **actionable**
  at a glance across a dense grid, and the magnifier is a weaker interactivity signal than
  the hand. It also implies magnification of the thing under it rather than a popover
  beside it.
- **`cursor: help`.** Literally "more information about this". Rejected as an
  under-promise in the other direction: it is conventionally attached to hover-revealed
  tooltips, so it invites a reader to hover and wait for something that never arrives.
- **`cursor: default`.** Kills the I-beam and claims nothing. Honest and purely negative —
  it removes a wrong signal without adding a right one, which leaves the original
  complaint standing.
- **Cursor only, no lift.** The one-line fix. Rejected at the prototype: against Month at
  its real four-chip density, the cursor alone was not noticeable enough to change what a
  reader believes about the grid.
- **Reopen the gesture — make it a single click.** The root cause, and out of scope by
  the ticket's own framing. `bindBubble`'s reasoning against it still holds, and a
  redesign of the gesture would take the `+N more` interaction and the Month scan pattern
  with it. Recorded so it is visibly *declined* rather than *unconsidered*: if the
  under-described cursor turns out to cost more than one click per reader, this is the
  door to open.
- **A hover state per type** — three background rules instead of one inset wash. Rejected:
  six values to keep in step across two colour schemes, to land in the same place the
  overlay reaches with one.
