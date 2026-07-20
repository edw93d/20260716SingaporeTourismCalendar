# ADR-0011: Pages is published from an artifact; the feeds are committed to the branch

- **Status:** Accepted
- **Date:** 2026-07-20
- **Ticket:** [#35](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/35)

## Context

#35 asks for two things that read like one: the feed is **published to Pages**, and the
feed **remains diffable in git even though the database blob is opaque**. The store is a
SQLite file (git-as-database, #10) — a human reading the history can see that it changed
and nothing more, so the `.ics` next to it is the only place the day's actual change is
legible.

There are two ways to put a file on Pages, and they answer those two requirements
differently:

| | Publishes | Diffable |
|---|---|---|
| Upload a build artifact | yes | no — the feed never enters git |
| Commit the built files to `gh-pages` | yes | yes, but on a branch nobody reads |

#35 raised the cost of the second: `DTSTAMP` is the **run instant**, so every daily run
rewrites every `.ics` file it emits — today only `venue-events.ics`, since `port-calls.ics`
has no source until #36 — whether or not a record changed. Committing them to a publish
branch means a commit per day whose entire diff is a timestamp, and the real content
changes drown in it.

What that framing missed is that **the choice is not exclusive.** Publishing and
diffability are served by different mechanisms, and nothing requires the published bytes
and the committed bytes to be the same copy.

## Decision

**Generate the feeds inside `site/`, commit that directory on `main`, and upload `site/`
to Pages as an artifact.**

- `src/paths.ts` puts `FEEDS_DIR` at `site/feeds`, *inside* the published root. One
  location serves both jobs, so the feed cannot be published and un-diffable, or diffable
  and unpublished.
- The workflow commits `data/calendar.sqlite` and `site/feeds` together, on the branch the
  run happened on. The feed diff sits beside the blob it explains.
- Pages is fed by `upload-pages-artifact`. **No `gh-pages` branch exists.**

## Consequences

- The daily commit carries one line of `DTSTAMP` churn per emitted feed. This is noise, but it is
  *bounded* noise sitting beside a store blob that changes every run anyway — every run
  bumps `lastSeenAt` on every record, so there was never a no-op commit to protect. Real
  content changes still show as additional diff lines rather than being replaced by the
  timestamp.
- **The `DTSTAMP` fix stays out of scope, and stays ADR-level.** RFC 5545 §3.8.7.2 wants
  `DTSTAMP` to be the **last-revision** instant for a `METHOD`-less feed, not the
  publication instant. Carrying that needs a `revisedAt` on both record types, which
  `CONTEXT.md` fixes. If the churn ever obscures something, that is the change to make —
  not a serializer tweak.
- A reader of the git history can answer "what changed in the calendar today?" without
  running anything, which is what the opaque blob otherwise takes away.
- Pages serves whatever the last successful run uploaded. A failed run leaves the previous
  site up rather than blanking it.

## Alternatives rejected

- **Artifact only, no committed feed.** The recommendation recorded on #35, and correct
  about publishing — it is simply silent on the diffability criterion, which nothing else
  in the design satisfies once the store is a blob.
- **Commit to `gh-pages` and pay for byte-stability.** Buys the same diffability at the
  price of a `revisedAt` field on both domain types, a `CONTEXT.md` change, and a publish
  branch that duplicates every byte. Committing on `main` gets the property for free.
- **Commit the feed to `main` and publish from a second copy under `dist/`.** Two
  locations that must not drift, for no gain over generating in place.
