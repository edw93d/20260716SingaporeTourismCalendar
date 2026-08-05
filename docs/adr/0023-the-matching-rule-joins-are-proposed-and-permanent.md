# ADR-0023: The matching rule — joins are proposed by title and date, and are permanent until a human splits them

- **Status:** Accepted
- **Date:** 2026-08-05
- **Ticket:** [#115](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/115)
- **Completes [ADR-0022](0022-the-cluster-and-the-field-ladder.md)**, which defined the **Cluster**
  and the field ladder and explicitly left *how records get into one* to this ticket.
- **Amends ADR-0022** in one place: the field ladder's last step could not separate two records
  from the same source, which §6 below makes a routine case. See *Decision §8*.
- **Supersedes v1's duplicate ruling.** `CONTEXT.md` and
  [ADR-0008](0008-ical-feed-shape-two-type-split-feeds.md) were built on *duplicates are accepted
  and labelled by source*. That acceptance is reversed here, deliberately and in writing.
- **Evidence:** [`docs/research/aggregator-overlap.md`](../research/aggregator-overlap.md),
  measured 05 Aug 2026 — the number ADR-0022 recorded as owed.

## Context

#115 asked what makes two records the same entry. ADR-0022 had already settled everything that
follows a match: records group into a **Cluster**, the calendar renders one entry per cluster, the
cluster holds the `uid`, and fields are merged down a six-step ladder. What was missing was the
rule that forms the cluster in the first place.

The ticket named four difficulties. All four survived contact with the data, and the measurement
added two more that reshaped the answer.

**The measurement was taken first, because ADR-0022 said the queue could not be priced without
it.** Three aggregators, live, 05 Aug 2026: EventsEye (168 rows), bigevent.io (13), TTGmice (13
Singapore rows). Its headline is that **aggregator↔aggregator overlap is small — 5 cross-source
duplicates across 194 rows** — and that this is the least useful thing it found.

### What the data changed

⚠️ **The commonest duplicate is not cross-source. It is one source publishing next year's
edition.** EventsEye lists an annual show a year ahead with no firm date, alongside the same show
firm-dated for this year — identical title, identical venue, nothing to disagree about. **61 of
its 79 soft-dated rows are this.** A title-and-venue rule joins two events a year apart, and a
join retires a UID (ADR-0022 §8). This is the expensive direction of error, and it is the
*majority* case.

⚠️ **Venue and date agreeing is not evidence.** **40 of 89 firm-dated EventsEye rows** share a
`(venue, start, end)` slot with a *different* show. Marina Bay Sands runs six co-located shows on
02–04 Sep 2026, six more on 29–30 Sep, six more on 10–12 Nov.

⚠️ **Title similarity has no usable threshold.** `INTER AIRPORT SOUTH EAST ASIA` / `Inter Airport
SEA` are the same show and score **0.74**. `THE FIRE SAFETY EVENT - ASIA` / `THE HEALTH & SAFETY
EVENT ASIA` are different shows and score **0.85**. Singapore trade-show titles are overwhelmingly
`<TOPIC> ASIA`, so co-located siblings are built to look alike.

⚠️ **A source duplicates itself.** `SEA ASIA`/`SEA-ASIA` and `THE SECURITY EVENT - ASIA`/`THE
SECURITY EVENT ASIA` are both single-source duplicates, and **2 of the 7 automatic joins in the
whole corpus** are EventsEye against itself.

## Decision

### 1. No date, no cluster

Two records join only if **both carry a firm date**. A record whose source gives a month but no
day — EventsEye's `Sept. 2027 (?)` — **never joins anything**. It stands alone as its own entry
until the source firms it, at which point it matches normally.

This is the load-bearing ruling, and it exists to make the false join structurally impossible
rather than merely unlikely. The alternative — matching on title and venue when dates are absent
— joins BEX Asia 2026 to BEX Asia 2027 in 61 places on today's data.

**Consequence, accepted:** soft-dated records publish as standalone entries with soft dates, and
for a period the calendar may carry both a soft entry and the firm one. That is visible and
correctable. A wrong join is neither.

### 2. Automatic joins: titles identical, dates overlap

A join is made **without a human** when, after normalisation (§3), two records' titles are
**identical** and their date ranges **overlap**.

7 joins in the corpus. This is the only path by which the system groups records on its own.

### 3. Normalisation is conservative, and deliberately so

Unicode NFKD with accents stripped; curly quotes straightened; case-folded; any four-digit year
removed; non-alphanumerics replaced with spaces; whitespace collapsed. **Nothing else.**

⚠️ **Domain words are not stopwords.** Stripping `asia`, `expo`, `week`, `singapore`, `show`,
`conference` as noise collapses `TECH WEEK SINGAPORE` and `ASIA TECH X SINGAPORE` into one key —
two different shows eight months apart — and merges four of the six co-located shows in each of
the slots above. In this corpus those words *are* the title. Recorded because it is an obvious
idea to have twice.

### 4. Everything else that is plausible goes to the admin, and the admin sees a lot

Two tiers reach the reviewer, on **#120's existing surface — no second one** (ADR-0022, #128):

| Tier | Test | Volume |
|---|---|---|
| **Near-title** | Titles similar (**≥ 0.50**) but not identical, dates overlap | 48 pairs |
| **Date window** | Titles identical, both dated, dates do **not** overlap, starts within **~60 days** | 2 pairs |

**~50 pairs across a 21-month corpus — roughly 2–3 a month.**

**Ed ruled the queue wide against the recommendation, and the absolute numbers support him.** A
0.90 threshold would show 2 pairs with no false positives; 0.50 shows 48, of which most are
co-located siblings that are obviously not duplicates. But it is the only setting that reaches
`Inter Airport SEA` (0.74), `Accounting Business Expo` / `Accounting and Finance Show` (0.69, a
probable rename), `The Meetings Show` / `Business Travel Show Asia Pacific` (0.67, genuinely
unclear) and `ITB ASIA` / `ITB Asia/MICE Show Asia` (0.52). Two of those four are calls only a
person can make. At 2–3 a month the noise is affordable; the missed duplicate is not.

**Below 0.50, nothing is shown.** The 0.40–0.48 band is 29 further pairs and contains no real
duplicate at all.

**The ~60-day window** separates a stale date from the next edition. The data is cleanly bimodal:
the one real stale-date case is **28 days** apart, and the nearest edition pair is **190 days**.
Any value from roughly 40 to 180 days behaves identically here. ⚠️ It cannot be widened toward a
year — editions are not reliably 12 months apart.

⚠️ **The volume grows quadratically in co-location, not linearly in calendar size.** A slot with
*n* concurrent shows generates *n(n−1)/2* pairs; the three six-show slots produce 45 between them.
A venue running ten concurrent shows would generate 45 pairs from that date alone.

⚠️ **Both thresholds are calibrated to one similarity function against one corpus.** 0.50 and 0.90
are not properties of the world. The function used is recorded in the research doc §9; a different
one needs recalibrating from scratch, and either number is meaningless without it.

### 5. A human's "not the same" is permanent

A reviewer's negative ruling on a pair is **stored and never re-proposed**. Without this the same
~50 pairs return every run and the queue is 50 decisions a day rather than 2–3 a month. This is
the ruling the whole tiering depends on.

⚠️ **It attaches to the pair of `(source, sourceKey)` identities**, which is the only identity
that survives everything else — clusters reshape and UIDs retire, but a record's key does not.
This is why §7's key constraint is not optional.

**A negative silences a suggestion. It does not police clusters.** It never breaks an existing
group, and it never prevents a group forming by another route. Breaking a group is a split, and a
split is only ever a human action (§6). Keeping the two apart stops one ruling having effects
elsewhere on the calendar that the reviewer never intended.

### 6. A join is permanent until a human splits it. Nothing dissolves on its own

Matching **only ever creates** a cluster. No rule removes a record from one.

Once EventsEye and bigevent.io are joined on BEX Asia, EventsEye moving to 09–11 Sep while
bigevent.io still says 02–04 Sep **does not break the join**. The disagreement is a field
conflict, and ADR-0022's ladder already settles it and already flags an equal-rank clash to the
admin without blocking publication.

The alternative was rejected on its consequence: if joins dissolved when their condition lapsed,
two sources disagreeing by a few days would retire a UID, push the entry out of every
subscriber's calendar, and then re-join under a *new* UID when the source caught up. Sources
bickering over a date would flap entries in and out of people's calendars.

⚠️ **A wrong join is sticky too.** Automatic matching can never correct its own mistake; only a
human split can. Given §4 deliberately routes ambiguity to a person, this is consistent: the
machine proposes, the human disposes, and the machine does not quietly revise its own verdict
afterwards.

### 7. Chained matches make one cluster

If A joins B and B joins C, there is **one cluster of three**, even where A and C would not have
matched each other. A cluster is a set, not a graph of pairwise links — which is what ADR-0022
already made it.

Date overlap is not transitive (12–14 Oct, 14–16 Oct, 16–18 Oct), but automatic joining also
requires **identical** titles, and three identically-titled listings at dates two days apart are
one trade show that three sources dated differently. Splitting them shows the same show twice,
which is the failure this ADR exists to prevent.

**No chaining occurs in the corpus** — all 7 joins are simple pairs. With 3 sources transitivity
is theoretical; at 21 it will not be. ⚠️ When it does occur the cluster will be too *large*, which
surfaces as one entry where there should be two and is correctable by a split. That is the
tolerable direction.

### 8. Matching is source-blind — and the ladder needs a step 7

The rule takes no account of which source a record came from. Two EventsEye rows join on exactly
the terms two rows from different sources do.

`SEA ASIA`/`SEA-ASIA` and `THE SECURITY EVENT - ASIA`/`THE SECURITY EVENT ASIA` are the same event
typed twice by one publisher, and **2 of 7 automatic joins are within-source**. A cross-source-only
rule would publish both, from the highest-volume source on the list, and would be unexplainable:
two identical listings grouped or not depending on a fact the reader cannot see.

⚠️ **This amends ADR-0022.** Its field ladder ends at *alphabetical by source key*, which cannot
separate two records from the same source — now a routine case rather than an impossible one.
**A step 7 is added: the record whose `sourceKey` sorts first.** Arbitrary, deterministic, and
guaranteed to terminate, on the same reasoning ADR-0022 gave for step 6.

⚠️ **Grouping never touches storage or counting.** Every record still lives under
`(source, sourceKey)` (ADR-0004), and **Source health** still counts both rows of a within-source
duplicate. A cluster is a layer above the records, not a rewrite of them.

### 9. There is no undo

Splitting is a **new forward action**, not a reversal. It does not restore what a join replaced.

ADR-0022 §8 settled the mechanics: a join retires the younger UID; a split keeps the UID on the
side holding the founding record and mints a fresh one for the other side. So joining A and B and
then splitting them leaves B with a **new** identity, not its old one. From a subscriber's side an
entry disappeared at the join and a different entry appeared at the split.

**This is not fixable and is recorded rather than hidden.** Restoring a retired UID would achieve
nothing on the subscriber's side — their client dropped the entry when it left the feed — and an
undo button would imply a wrong join is cheap, which is exactly the belief that produces careless
joins.

✅ **No data is ever lost.** Every record survives exactly as scraped through any number of joins
and splits; only the grouping changes. A bad join costs churn in subscribers' calendars. It never
costs information, and it is always correctable.

**Who joined or split what, and when, is a moderation-state question and belongs to
[#116](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/116).** Not settled here.

## Consequences

- **Nothing in the codebase changes shape.** `Source`, `Scraped`, `sourceKey` and the adapter seam
  (ADR-0004, ADR-0005) are untouched. Matching is core logic that runs after `parse` and before
  ADR-0022's ladder.
- **The admin surface gains one flag type** — an ambiguous match — on #120's existing surface,
  alongside the relevance verdict (#116/#120) and ADR-0022's equal-rank clash. **No new surface.**
- **The negative-ruling store is new persisted state**, keyed by a pair of
  `(source, sourceKey)` identities. It lands on
  [#117](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/117) (storage) and
  [#121](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/121) (the contract),
  next to the cluster itself.
- **ADR-0022's ladder gains step 7.** `CONTEXT.md` § *Cluster* is updated in place.
- ⚠️ **A constraint is handed to the adapter work, not decided here.** ADR-0004 makes `sourceKey`
  the adapter's business. But for a source with no native identifier, keying on the **exact date**
  turns a soft date firming up into a new record — abandoning the old one, retiring its UID, and
  costing the subscriber the entry. **61 EventsEye rows are in that state today**, a third of the
  source. Keying on **title + venue + year** was tested: 168 rows → **165 keys**, and all 3
  collisions are genuine duplicates. This belongs to #113's adapter specs and #121's contract.
- ⚠️ **Consumer sources are unmeasured.** The evidence is three trade-show aggregators. Eventbrite,
  SISTIC and Ticketmaster publish a different kind of thing at a different volume — SISTIC alone
  carries 284 events, 88% unique to it (#131). Neither threshold has been tested against them.
- **v1's `accept duplicates, label by source` is dead.** `CONTEXT.md` said so on the `Scraped`
  table and ADR-0008 built the two-feed split partly on it. The reversal is explicit here so it
  cannot later look like drift.

## Alternatives rejected

- **Match on title + venue, ignoring dates when absent.** The obvious rule, and the one the ticket
  implies. Rejected outright: it joins next year's edition to this year's in **61 places** on
  today's data, and each join retires a UID.
- **Match on venue + date.** Rejected on measurement — **40 of 89** firm-dated EventsEye rows
  share a venue-and-date slot with a different show. It carries no evidence at all.
- **A stricter queue at 0.90 similarity.** Recommended, and **overruled by Ed** in favour of a
  wider net the admin verifies by hand. It would show 2 pairs with no false positives and miss
  four real duplicates, two of which require human judgement to call at all.
- **A looser queue below 0.50.** Rejected on measurement: 29 further pairs, no real duplicate
  among them.
- **Strict date-overlap only, with no window.** Simpler and never wrong-joins, but publishes
  `SEA Asia` twice a month apart with nobody told.
- **Joins that dissolve when their condition lapses.** Rejected — it makes routine date drift
  between two sources retire a UID and flap entries in and out of subscribers' calendars.
- **Pairwise links rather than a set**, so A–B and B–C need not imply A–C. Rejected: it renders
  the same show twice for a two-day date disagreement.
- **Cross-source matching only.** Rejected: it publishes `SEA ASIA` and `SEA-ASIA` side by side
  from one source, and the rule cannot be explained to a reader.
- **A "not the same" ruling that also breaks existing clusters.** Rejected: one ruling would have
  effects elsewhere on the calendar that the reviewer never saw or intended.
- **A true undo that restores retired UIDs.** Rejected: it restores nothing on the subscriber's
  side, and it advertises a reversibility that does not exist.
- **Fuzzy matching by embeddings rather than string similarity.** Not rejected on merit —
  untested, and it would need a calibration corpus this ticket does not have. The thresholds here
  are explicitly tied to the method used to derive them (§4).
