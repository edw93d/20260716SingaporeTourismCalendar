# ADR-0004: Adapters own an opaque sourceKey; records are never deleted

- **Status:** Accepted
- **Date:** 2026-07-16
- **Ticket:** [#7](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/7)

## Context

#6 established that **UID is durable state** — minted once, persisted, never
recomputed — because every hash input is mutable, and a *rescheduled* conference must
move rather than duplicate. That requires looking UID up by a **natural key**.

But the three sources cannot agree on what a key is:

| Source | Native identifier |
|---|---|
| MBCCS | a real `id` field |
| Suntec | a URL slug — `/visit-events/bni-vision1472026` — **which embeds the date** |
| SCC | **nothing.** An HTML table row |

No single core-owned rule serves all three. A uniform composed key would discard
MBCCS's perfectly good stable ID in favour of a weaker guess.

Separately, a record present yesterday and absent today could mean cancelled,
rescheduled, scrolled past the ~3-month source window, or **the scraper silently broke**.
The source never says which.

## Decision

**1. `sourceKey` is opaque and adapter-owned.** Each adapter computes a stable key for
its own source; the core stores identity as `(source, sourceKey)` and never inspects it.

```
MBCCS  → raw.id
Suntec → slug from detail URL
SCC    → `${vessel}|${arrivalDate}`

uid = lookup(source, sourceKey) ?? mint(source, sourceKey)
```

This follows the standing constraint that a new source is a new scraper module:
source-specific knowledge belongs in the source-specific module.

**2. Records are never hard-deleted.** Each carries `firstSeenAt` / `lastSeenAt`; a
scrape upserts by `(source, sourceKey)` and bumps `lastSeenAt`. Absence means
`lastSeenAt` stops advancing — nothing more is inferred.

## Consequences

- **#8 (adapter interface):** `sourceKey()` is part of the contract.
- **#9 (breakage detection):** `lastSeenAt` staleness is the raw signal, and it
  distinguishes a broken scraper from MBCCS's valid "no scheduled cruises" empty state.
- **A reappearing record keeps its UID**, rather than detonating subscribers' entries
  with a fresh one.
- **Retention of past events becomes a display question, not a storage one** — we keep
  everything; how far back the calendar *reaches* is a separate product choice.
- No status is inferred that the source never stated.

### Accepted limitations

- **SCC duplicates on reschedule.** Its key must embed the arrival date, so a shifted
  arrival is a delete-plus-create rather than a move — the exact failure #6 warned of.
  The source exposes nothing stable; this cannot be designed away in v1.
- **Suntec's slug stability is an assumption, not a fact.** The slug embeds a date
  (`1472026` = 14/7/2026), but a Squarespace slug is frozen at creation rather than
  re-derived, so it *should* survive a reschedule. **This has not been observed.** If
  wrong, Suntec inherits SCC's flaw — contained inside the adapter, which is precisely
  why the key is opaque.

## Alternatives rejected

- **Uniform composed key in core** — `(source, kind, normalized name, venue)`. Survives
  a reschedule but breaks on a typo fix, and discards MBCCS's real ID.
- **Source-native ID only.** Would block SCC and possibly Suntec, gutting the cruise
  coverage that is the whole reason this audience is served.
- **Scrape as full replacement.** Simple, but a broken scraper silently empties the
  calendar and reappearing records mint fresh UIDs.
- **Explicit `status` enum** (`active | cancelled | expired`). Fabricates certainty the
  source never provided.
