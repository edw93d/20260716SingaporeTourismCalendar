# Prototype: the Month landing (throwaway)

Three landing rules, switchable via `?variant=`, on a copy of the real site page
with the real `calendar.json`. **Throwaway — never merged to `main`.**

```
npm run prototype:landing     # http://localhost:4173
```

## The question

`applyScrollTarget` brings a day to the top of the viewport after a render. In
Month the day's node is its **cell**, so today's *week row* goes to the top and
the weeks above it scroll off — which violates ADR-0014 §1, "Month is fixed to
one screen". It fires on three paths: first load, a view switch, and Today.

Only a real browser can answer this. jsdom has no layout, which is exactly why
three tests currently assert this behaviour as correct.

## The variants

| | Rule | Note |
|---|---|---|
| **A** | The day's node always, every view | What `main` ships today — the baseline bug |
| **B** | Views with a **horizontal** day axis (Month, Week) land on the surface; **vertical** ones (Agenda, Date-spine) keep the day's row | The proposal |
| **C** | Month requests **no landing at all** — the reader's scroll is left where it is | The rejected alternative, built so the rejection is checked rather than assumed |

B also carries `scroll-margin-top` on `.calendar__surface`, matching what
`[data-day]` already has, so Month's top edge is not flush under the header.

## What to try in each

1. **Load the page.** A is the bug at rest — today is late in the month, so the
   first weeks are above the fold on arrival.
2. **Scroll down to the ICS subscription block, then press Today.** A yanks you
   to today's row; B brings the whole month up; C does nothing visible, which is
   the objection to C.
3. **Switch to Agenda, then back to Month.** All three paths, one surface.
4. **Check Week, Agenda and Date-spine under B** — they should be unchanged.

## Verdict

**B wins.** Folded into `main` as the **Landing** rule — issue #107, PR #108.

A and C are indistinguishable from B *at rest*, because a fresh load starts at
`scrollY` 0 and both put the whole month on screen. They only diverge once the
reader has scrolled. Measured at 1440x900, viewport 816:

| | Today from the ICS block | Date-spine -> Month: grid top / bottom | whole month visible? |
|---|---|---|---|
| **B** | `scrollY` 384 -> 0 | 148 / 722 | **yes** |
| **C** | 384 -> 384 (no-op) | **-293** / 281 | no |

C was rejected on that second column: it reaches the *reported* bug by a
different trigger — three week rows off the top, over half the screen given to
the methodology notes — so it is a hole rather than a rule. It removes Month's
landing and leaves the reader wherever the previous surface put them, on a page
whose footer is taller than its grid.

Two things the prototype settled that argument alone had not:

- **Week's day node and the surface are the same pixel** (both 148), so folding
  Week into the rule by axis is free rather than a widened blast radius.
- **The bug fires on first load**, before any control is touched — so scoping the
  fix to the Today control would have left it in place.
