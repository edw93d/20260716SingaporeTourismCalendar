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

_(record which variant won and why, then fold it into the real code)_
