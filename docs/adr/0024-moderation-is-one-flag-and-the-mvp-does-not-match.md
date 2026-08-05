# ADR-0024: Moderation is one flag on one type, and the MVP does not match records at all

- **Status:** Accepted
- **Date:** 2026-08-05
- **Ticket:** [#116](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/116)
- **Supersedes [ADR-0022](0022-the-cluster-and-the-field-ladder.md)** — the **Cluster** and the
  field ladder are not built for the MVP.
- **Supersedes [ADR-0023](0023-the-matching-rule-joins-are-proposed-and-permanent.md)** — no
  automatic matching is built for the MVP. **Its `sourceKey` constraint survives** (Consequences).
- **Amends [ADR-0020](0020-second-hand-sources-are-admitted-first-hand-wins-ties.md)** —
  **Provenance** keeps its name and its admin-facing description, and loses its tie-breaking job,
  which existed only as step 4 of ADR-0022's ladder.
- **Confirms [ADR-0001](0001-two-types-one-projection.md)** — see *Decision §8*.
- **Evidence:** [`docs/research/aggregator-overlap.md`](../research/aggregator-overlap.md), the
  measurement taken for #115. It is the reason this ADR is affordable, not a casualty of it.

## Context

#116 asked what states an entry can be in, what they are called, and what moves it between them.
It expected a lifecycle. It got one boolean, because answering it first required answering a
question the ticket did not ask.

**The prior question is whether the MVP matches records at all.** ADR-0022 and ADR-0023, accepted
on 05 Aug 2026, settled that duplicate records group into a **Cluster** which renders as one entry,
that matching proposes joins automatically on identical titles and routes the ambiguous ones to a
reviewer, and that a join is permanent. Everything #116 had to name — the ambiguous-match verdict,
the permanent *not the same*, join and split history — descends from that machinery.

Ed reopened it while grilling #116, on scope: the aim is an MVP running as soon as possible, and a
moderator who can hide an entry is a simpler answer to duplicates than a matching rule is.

**The measurement supports him, and it is the same measurement that produced ADR-0023.**

- **Cross-source overlap is 5 duplicates in 194 rows.** Two of the three source pairings —
  EventsEye×TTGmice and bigevent×TTGmice — produced **zero**. The entire matching apparatus exists
  to catch about five things.
- **SISTIC is 88% unique to itself** across 284 events (#131). The only consumer-source evidence
  available points the same way.
- **The commonest duplicate in the corpus costs nothing here.** EventsEye's 61 soft-dated
  next-edition rows were never going to be joined — ADR-0023 §1 refuses to join a record with no
  firm date. They render separately under either model.

**Dropping matching drops the cluster with it**, because nothing would ever put two records in one.
That is where the build cost actually sits: one entry per cluster, the UID following a founding
record, join, split, the negative-ruling store, and the ambiguous queue on #120. The matching rule
itself is cheap — `difflib` is stdlib. Backing out of matching is worth it precisely because it
makes the expensive thing unnecessary.

## Decision

### 1. The MVP does not match records. Duplicates are accepted and hidden by hand

No automatic joining, no similarity scoring, no thresholds, no ambiguous queue, no clusters, no
field ladder, no splits, no negative-ruling store. Every record stands alone under
`(source, sourceKey)` and renders as its own entry.

This **restores v1's ruling** — *duplicates are accepted and labelled by source* — which ADR-0023
had reversed. The addition over v1 is that a human can now hide one.

⚠️ **ADR-0022 and ADR-0023 are not wrong. They are unaffordable for the MVP.** Nothing in their
reasoning has been refuted, and the corpus they were measured against has not changed. They are the
shape to return to when duplicate volume justifies the machinery; see *Reopen trigger*.

### 2. `hidden` is a single boolean on `VenueEvent`, set only by a person

```
VenueEvent { …, hidden }
```

- **`VenueEvent` only.** `PortCall` does not carry it: there are exactly two terminals, both
  first-hand, no aggregator reports them, so a cross-source duplicate is near-impossible and a ship
  docking is never irrelevant. A broken cruise row is a **parser** fault and belongs in ADR-0006's
  `failures[]`, where it is visible, rather than hidden off the calendar where it is not.
- **`ArrivalsSummary` does not carry it.** It is recomputed from `FlightArrival` rows on every run
  and there is exactly one per date by construction — nothing to judge, and a flag would need
  special handling to survive the recompute. `FlightArrival` has no `uid` and never renders.
- **Only a human ever sets it.** No rule, no adapter, no pipeline step. A row that cannot be parsed
  into a usable event — RWS's `0001-01-01` dates — is already a broken row under ADR-0006 and never
  becomes a `VenueEvent`, so there is nothing there for a machine to hide. Were the pipeline able to
  set the flag too, it would mean two things that cannot be told apart afterwards — *I judged this*
  and *the software found this odd* — which is the exact overloading #116 exists to remove.

### 3. No reason and no history are stored

The flag records **that** an event is hidden. Not why, not when, not by whom.

Three reasons to hide exist in practice — not tourism or MICE, the same show as another row, and
unusable data — and none of them changes what happens, so none is stored.

⚠️ **Accepted cost, recorded because it is unrecoverable.** Without the reason there is no way to
count how much of a source is being hidden as irrelevant, which is evidence the volume question
(map #112's remaining fog) would have wanted; and the decision to reinstate matching will be a
judgement rather than a measurement, because the *duplicate* hides would have been a hand-labelled
set of exactly the joins ADR-0023 would have made. Recommended and **overruled by Ed** on MVP
scope. "Who" is not stored for a better reason: there is one moderator.

### 4. `hidden` is remembered state, not observed state

It sits with `uid`, `sequence`, `firstSeenAt` and `lastSeenAt` on the core side of ADR-0005's
observe/remember line, and is **excluded from `Scraped<T>`**:

```
Scraped<T> = Omit<T, 'uid' | 'sequence' | 'firstSeenAt' | 'lastSeenAt' | 'hidden'>
```

An adapter reading today's HTML cannot know a judgement a person made last week. More sharply: if
`hidden` were part of what `parse` returns, the next run's upsert would silently un-hide everything
ever judged. The type makes that unwritable rather than merely discouraged — the same argument
ADR-0005 made for the other four fields.

### 5. Visible by default. The admin page is a cleanup list, not a gate

A newly scraped record renders immediately. Nothing waits for approval.

An approval gate at the volumes in evidence — EventsEye 168 rows, SISTIC 284, Suntec ~154–178 per
scrape, refreshed daily — is a few hundred decisions a day for one person, and is the thing that
stops the MVP existing. The risk it would buy back is small: **ADR-0021 establishes that v2 does not
publish.** The repository is private, the calendar is personal, there is no revenue. A junk row
costs a day of the operator's own noise.

⚠️ **Publishing v2 reopens this**, on the same terms ADR-0021 already sets for the barred-source
position.

### 6. Hidden means absent from the web calendar and from every feed

One word, one meaning, both surfaces.

Hiding on the website only would leave the junk in the operator's own calendar app — the surface
this project is actually read on — so it would fix the surface that matters least.

⚠️ **This is not the absence that Seen-tracking governs, and the two must not be conflated.** A
record that stops being scraped keeps rendering: ADR-0004 refuses to resolve absence into a status
the source never stated, and `lastSeenAt` simply stops advancing. Only a person's judgement removes
an entry from the calendar.

`STATUS:CANCELLED` was considered as a way to tell a client rather than silently dropping a row, and
rejected: the event was not cancelled, it was irrelevant, and saying otherwise is the field
overloading `CONTEXT.md` bans. Client support is also unreliable — ADR-0001 found `CATEGORIES`
survived on 1 of 3 clients.

### 7. Hiding is genuinely reversible, and this is a property of dropping the cluster

Unhide restores the same entry, with the same `uid`, to the same subscriber. The record's identity
never moves: nothing is retired, nothing is minted.

⚠️ **This directly contradicts ADR-0023 §9's "there is no undo", and is the reason to state it.**
That ruling was true of *splits*, because a join retired a UID that a split could not give back.
With no joins there is no retirement, so undo is real rather than a forward action wearing undo's
clothes.

### 8. Hidden records are filtered out before projection. ADR-0001 stands

`CalendarEntry` is unchanged — seven fields, no `hidden`. Hidden records are removed **before**
anything is projected, so the web calendar, the feed writers and any later Excel export never
receive one and cannot forget to check.

The admin page reads `VenueEvent` directly rather than through the projection, which `CONTEXT.md`
already permits: *"CalendarEntry is a convenience, not a bottleneck. A serializer needing those
reads the domain types directly."*

#116 asked whether "the schema is dictated by the ICS format". **It is not, and `hidden` is the
proof.** There is no RFC 5545 property meaning *a human decided this should not be here*; the two
nearest candidates are unsupported (`CATEGORIES`, ADR-0001) or dishonest (`STATUS`, §6). A field the
serialization format cannot express, on a record it must never emit, is a field that could only have
come from the domain. ICS is where records go out. **ADR-0001 is confirmed, not reversed.**

### 9. Hand-entry is a source named `manual`

A human can type in an event no source published. It is modelled as a source, not as a new shape:

| | |
|---|---|
| `source` | `manual` |
| `sourceKey` | minted by the admin page |
| `firstSeenAt` | when it was typed |
| `lastSeenAt` | the same instant, and it never advances |
| Source health | **exempt by name** |

Keeping `(source, sourceKey)` as the universal identity is what makes every other ruling here hold.
The alternative — a record with no source at all — breaks the one rule the whole model leans on, to
save a row in the source manifest.

⚠️ **The Source-health exemption is not a special case so much as an undefined one.** ADR-0007's
net-drop test compares against a **previous run's cohort**; `manual` is never fetched, so it has no
runs and the signal has nothing to read. Excluding it by name is honest. The alternative reading —
that a `manual` record's frozen `lastSeenAt` looks like a source going quiet — is exactly the false
alarm the exemption prevents.

⚠️ **This is a second write path into the store**, and it is the only exception to *every record
comes from an adapter*. It lands on #117 (storage) and #121 (the contract).

### 10. It is a property, not a lifecycle

There is no state machine, no intermediate state, and no transition worth naming. `CONTEXT.md`
records `hidden` as a property of a record.

Recorded because #116 asked for a state set and this is emphatically not one; without saying so, a
reader meets a boolean where a lifecycle was promised and starts adding the missing states.

## Consequences

- **The calendar shows some events more than once**, until a person hides the copies. Measured at 5
  cross-source duplicates in 194 rows, so this is a handful of decisions, not a job.
- ⚠️ **Best-field-wins is gone.** Where one source publishes `Sands Expo, Hall D` and another bare
  `Singapore`, the operator hides one and keeps whatever the survivor says. ADR-0022's ladder took
  the better field from each; nothing does now.
- ✅ **No machine can cost a subscriber an entry.** ADR-0023's worst consequence — a wrong automatic
  join retiring a UID, unfixably — cannot occur. Every entry keeps the `uid` it was minted with,
  through hiding and unhiding alike.
- **The UID returns to the record.** ADR-0022 moved it to the cluster; with no clusters it is held
  by the record and minted against `(source, sourceKey)`, exactly as ADR-0004 has it.
- ⚠️ **ADR-0023's `sourceKey` constraint survives untouched and still binds.** It never depended on
  matching. For a source with no native identifier the key must be **title + venue + year, never
  the exact date** — keying on the date turns a soft date firming up into a *new* record, abandoning
  the old one and retiring its UID. **61 EventsEye rows sit in that state today.** Tested against
  the corpus at 168 rows → 165 keys, all 3 collisions genuine duplicates. Filed on
  [#113](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/113) and
  [#121](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/121); unaffected here.
- **Provenance loses its only behavioural job.** It survives as the admin-facing description of what
  a source is (`event venue`, `event aggregator`, `ticketing platform`, `cruise terminal`,
  `airport`) so a reviewer can see where a record came from. ADR-0020's admission of second-hand
  sources stands; only its tiebreak goes.
- **#120 loses a question and keeps a surface.** There is no ambiguous-match queue and no
  equal-rank clash to show, so the admin page is a list with a hide toggle plus a hand-entry form.
  ADR-0023's *no second surface* rule is moot rather than violated.
- **#117 and #121 get smaller.** No cluster to persist, no negative-ruling store. They gain one
  boolean and the `manual` write path.
- **`CONTEXT.md` loses its `Cluster` and `Matching` entries.** They describe machinery nothing
  builds, and a domain document that describes two models at once cannot be read. The reasoning is
  preserved in ADR-0022 and ADR-0023, which is what decision records are for.
- **`docs/research/aggregator-overlap.md` is retained and is now the evidence for this ADR.** The
  5-in-194 measurement is what makes hide-only affordable. It was taken for #115 and outlives the
  ruling it produced.

### Reopen trigger

Matching and the cluster return as a **destination redraw**, not a quiet patch, when any of:

- **v2 publishes.** §5's default-visible ruling rests on ADR-0021's non-publication, and duplicate
  entries stop being a private annoyance.
- **Hiding duplicates becomes routine work** rather than a handful of decisions — the consumer
  sources (Eventbrite, Ticketmaster, SISTIC) are unmeasured for overlap and could change this.
- **Best-field-wins is missed in practice** — an entry is materially wrong because the record that
  survived a hide carried the worse venue or date.

ADR-0022 and ADR-0023 are the answer when it does; they are measured, argued and complete. ⚠️ Their
thresholds are calibrated to one corpus with one similarity function and would need recalibrating
against whatever the source list looks like then.

## Alternatives rejected

- **Keep ADR-0023 as accepted.** The correct calendar, and rejected only on cost — the cluster,
  join, split, negative store and ambiguous queue are most of the moderation build, in service of 5
  measured duplicates.
- **Keep the cluster but only auto-join on identical titles**, dropping the 0.50 similarity queue.
  Zero false positives in the corpus and no thresholds to calibrate — but it keeps the cluster,
  which is where the build cost is, so it saves the cheap half and pays for the expensive one.
- **A relevance state and a duplicate state, named separately** — #116's own framing. Rejected:
  under hide-only both produce the identical outcome, so two names would describe one behaviour.
- **Store a closed list of hide reasons** (`not-relevant` / `duplicate` / `bad-data`). Recommended
  for its evidence value and **overruled by Ed** on MVP scope. See §3.
- **Store a `hiddenAt` timestamp**, to tell a hide that predates a change to the row underneath it
  from one that follows it. Recommended and **overruled** — consistent with storing no reason.
- **A full change log of hides and unhides.** Rejected: one moderator, and ADR-0023's join/split
  history — the thing #116 inherited — has nothing left to record.
- **Hidden until approved.** Rejected on arithmetic: a few hundred approvals a day for one person.
- **Hide the website only, leaving feeds intact**, so no subscriber loses an entry they hold.
  Rejected: it leaves the junk in the operator's own calendar app, the surface actually read.
- **`STATUS:CANCELLED` in the feed** rather than dropping the entry. Rejected as a false statement
  about the event, and unreliable in clients.
- **`hidden` on `CalendarEntry`, with each serializer filtering.** Rejected: it makes "remember to
  check the flag" true in three places, where filtering first makes the mistake impossible.
- **`hidden` on `PortCall` too.** Rejected: a broken cruise row is a parser fault that ADR-0006's
  `failures[]` should surface, and hiding it would paper over the fault.
- **A hand-entered record as its own type with no `source`.** Rejected: `(source, sourceKey)` as the
  universal identity is what every ruling here rests on.
- **Leaving hand-entry out of the MVP entirely**, on the grounds that the operator's own calendar
  app already lets them type an event. Recommended and **overruled by Ed** — a typed entry would
  otherwise never reach the website or any feed.
- **The pipeline auto-hiding unusable records.** Rejected: it gives one flag two meanings that
  cannot be told apart, and turns a broken scraper into a tidy calendar.
