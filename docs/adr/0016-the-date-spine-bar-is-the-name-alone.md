# ADR-0016: The Date-spine bar is the name alone — the one readable line goes to *what*, not *how long*

- **Status:** Accepted
- **Date:** 2026-07-28
- **Ticket:** [#100](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/100)
- **Supersedes:** [ADR-0015](./0015-the-date-spine-bar-is-two-lines.md), **in part** — its Decision only.
  Everything 0015 argues about the geometry still holds and is not restated here.
- **Constrained by:** ADR-0009 §3 (a bar's height *is* its duration).

## Context

ADR-0015, accepted earlier the same day and shipped in #99, cut the Date-spine bar from
the four-line reading-surface entry to two lines: **the duration, then the name.** The
reasoning was right and is untouched by this. What it got wrong is which of the two
survivors goes first.

The arithmetic 0015 itself sets out is the whole argument. A one-date bar is one
`--spine-row` less the hairline inset — `28 − 2 = 26px` — less `0.1rem` of block padding,
leaving **22.8px of content box** against a `0.72rem/1.2` line of **13.8px**. Two lines
need 27.6px. 0015 saw this and accepted clipped descenders as the price.

But the price is not descenders. On a one-date bar there is room for **one** line, and
0015 gave it to the duration. Most of July is one-date entries, so the shipped view named
a *length* on nearly every bar and an *event* on almost none — the same failure #98
reported, one field along. #98's own complaint was "the view answers 'how long' and never
'what'", and #99 answered it by making "how long" the first thing you read.

## Decision

**The Date-spine bar draws one field — the event name — over as many lines as the bar's
own height allows, ellipsised where more remains.** The duration comes off the bar
entirely and lives in the **Entry-detail bubble**'s `Length` row (#75).

Four things follow, decided rather than defaulted:

1. **The duration is not added to the `title`.** The tooltip is where a *label* field
   lands when the surface has no room to draw it — the location and the source, as on the
   **Month** chip. Length was never a label field on any surface; it is a bubble field.
   Putting it on the hover would have made the fallback one gesture instead of two, and
   was weighed and declined to keep the tooltip's meaning single.
2. **The name is clamped, not clipped.** `renderSpineBar` publishes `--spine-bar-lines`
   from the rows the bar actually draws, and the stylesheet clamps to it. #99 let
   `overflow: hidden` cut the text, which leaves a truncated title and a short one looking
   identical. The count is per-bar geometry, so only the renderer can know it — the same
   reason the row and lane percentages are published rather than inferred.
3. **The clamp counts the rows *drawn*, not the entry's true span.** A congress running
   29 June – 2 July draws two rows in July, so it gets the three lines two rows hold. The
   whole-span count would clamp to five and put the name back past the clip edge.
4. **The `0.72rem/1.2` type scale stays, and its justification changes.** 0015 called the
   scale "the constraint, not a preference" because it is what fits two lines in 28px.
   There is one field now, so that reason is void and the scale needed re-deciding on its
   own merits. It is kept as an explicit **preference**: the bar is the narrowest surface
   in the product, and the smaller face buys ~10% more characters per line plus a whole
   extra line on a tall bar — five on a three-row bar against four at the reading-surface
   `0.8rem/1.3`. Recorded so the next reader does not "restore" `0.8rem` on the strength
   of a dead constraint.

## Consequences

- **The spine no longer says how long, at rest.** ADR-0009 §3 rounds a bar to whole day
  rows, so an 8 hr fair and a 20 hr port call are the same one row and the label was the
  only thing carrying the clock. That resolution is now behind a **double-click**. This
  is the cost of the decision, accepted knowingly: on a surface with one readable line,
  the name is worth more than the hour count, and the hour count is not lost.
- **The accepted cruise-magnitude hole (ADR-0009 Consequences) widens slightly** — the
  bar could previously distinguish a 3 hr call from a 20 hr one by its label, and now
  cannot. The reopen trigger on that hole is unchanged.
- **0015's clipped-descender consequence is retired.** With one line in a 22.8px box
  there is 9px of slack, so the one-date bar no longer cuts through its own glyphs.
- **`renderSpineBar` sheds a child node.** The bar is now a text node with a clamp, so
  `.spine__len` and its stylesheet block are gone. It is still its own builder rather
  than a branch in `renderLeaf`: the clamp is per-bar geometry a shared builder would
  have to take as a parameter.
- **`spineBarLines` duplicates four px values the stylesheet owns** (`--spine-row`, the
  hairline inset, the block padding, the type scale). Drift does not throw — it silently
  clamps to a line count the bar no longer has — so a test asserts the stylesheet still
  declares them, at the seam.
- **`spanText` keeps its single rounding rule** and now has one caller at render time,
  the bubble. A bar and its bubble could not disagree before and still cannot.

## Alternatives rejected

- **Swap the two lines — name, then duration.** The minimal change, and it would have
  read correctly on multi-day bars. Rejected because on a one-date bar the duration line
  would simply clip away, so the same entry would tell the reader different things
  depending on its length — the objection 0015 itself raised against length-dependent
  content, and it is right.
- **Duration trailing on the same line**, dimmed. Keeps it always visible, but spends
  the *horizontal* axis, which is the scarcer one: a four-lane day gives each bar a
  quarter of the track, and a constant suffix eats the vessel or the hall exactly as the
  `Cruise: ` prefix did.
- **Keep the silent clip, no ellipsis.** Cheapest, and it spends no character on the
  ellipsis. Rejected: a bar that cannot say it has been truncated is the half of #100
  about not being able to trust what you read.
- **Return to the reading-surface `0.8rem/1.3`** now that the two-line constraint is
  gone. Rejected — see Decision §4. Fewer characters on every bar and one line fewer on
  the tall ones, which is exactly where the long titles are.
- **Edit ADR-0015 in place** rather than superseding it. Rejected: 0015 shipped, and its
  geometry reasoning is load-bearing and still true. Rewriting it would erase the record
  that duration-first was tried, which is how it gets proposed again.
