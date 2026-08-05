# ADR-0022: The cluster and the field ladder

- **Status:** Accepted
- **Date:** 2026-08-05
- **Ticket:** [#129](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/129)
- **Supersedes no ADR.** It completes [ADR-0020](0020-second-hand-sources-are-admitted-first-hand-wins-ties.md),
  which named `first-hand`/`second-hand` and left both the mechanism and the second-hand-vs-second-hand
  gap open.
- **Narrows ADR-0020** in one respect: **Provenance**'s job is smaller than that ADR's wording implies.
  See *Decision §6*.
- **Hands [#115](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/115) the matching
  rule and does not pre-empt it.** This ADR says what a cluster *is* and what follows once records are
  in one. It does **not** say how records get into one.

## Context

#129 asked whether a **Source** carries a *trust tier* and what that tier decides. Ed's proposal was
that venue websites are *primary* and ticketing platforms and aggregators are *secondary*, whose events
*"will only be added if not a duplicate entry"*.

Two things had to be faced before that could be turned into a rule.

**The phrasing hid a conflict.** *"Only added if"* is an ingestion-time admission rule — the secondary
record never enters the store. That contradicts
[#112](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/112)'s destination, *"a store
that retains every record but marks some wrong"*, and Ed's intent on #115, *"nothing is deleted"*.
Resolved on [#128](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/128): **store and
group, never drop.** Dropping a duplicate row would also blind every per-source signal in
`CONTEXT.md` § *Source health* — a source going quiet would be indistinguishable from a source being
deduplicated away.

**The tier already existed.** ADR-0020 modelled exactly the shape Ed proposed, under the name
**Provenance**, and explicitly *considered and dropped* credibility as a second ranking axis. So #129
adds no property. Its whole remaining job was to specify what the existing one decides, and to close
the gap ADR-0020 left open in writing: ⚠️ *"it gives no tiebreak between two second-hand sources — the
most common duplicate"*.

That gap is not an edge case. Marina Bay Sands' own expo directory is a **rolling 3-day window**, and
MBS is **60% of what EventsEye carries**. For any MBS trade show more than three days out there is **no
first-hand record at all** — only two or three aggregators of equal rank. #113 predicted bigevent.io
*"will duplicate EventsEye and TTGmice heavily"*.

### Four rulings inherited from #128

Decided there, recorded here because this ADR is built on them:

1. **Cluster, never delete.** Every record is kept as scraped under `(source, sourceKey)` — ADR-0004
   untouched. Records describing the same real-world event are linked, and the calendar renders one
   entry per link.
2. **Merge field-by-field.** ⚠️ **First-hand does not mean better data.** RWS is first-hand and
   publishes `0001-01-01` null sentinels on 33 of 48 cards; bigevent.io is second-hand and publishes
   clean ISO instants. A record-level *first-hand wins* rule would discard good data for bad.
3. **The cluster holds the UID.** Under a replace-the-record rule, a first-hand record arriving late
   would re-mint a UID and break every live subscription. ADR-0004: minted once, never recomputed.
4. **Ambiguous matches go to the admin**, on the same surface as
   [#120](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/120) — not a second one.

## Decision

### 1. Provenance is the tier. There is no second axis

`first-hand`/`second-hand` (ADR-0020) is the only ranking property a source carries. **"Primary" and
"secondary" are retired as vocabulary**, so the idea cannot resurface as a separate concept — and with
them the *"only added if not a duplicate"* phrasing, which is now contradicted by §2.

The **Source** contract is untouched: `key`, `fetch`, `parse`, opaque `Raw`. Provenance stays source
manifest metadata, exactly as ADR-0020 placed it.

### 2. A cluster is a set of records rendered as one entry, and it holds the UID

**Cluster** enters the glossary. A cluster is a set of **Scraped** records believed to describe the
same real-world event; the calendar renders **one entry per cluster**; the cluster holds the entry's
`uid` and `sequence`.

**How records come to be in one cluster is #115's rule, not this ADR's.** This ADR defines the noun
because every ruling below is phrased in terms of it and #129 blocks #115 — without a definition here,
the term would ship undefined.

### 3. Provenance is a property of the source, flat — not of the record

One label per source, applying to everything it publishes. **Sentosa is first-hand for the whole
island**, including events run by other operators on it, and RWS is separately first-hand for its own.

The per-record alternative — first-hand only within a declared remit of owned venues — was rejected on
data. It would key off `venue`, the field most often missing: bare `Singapore` on **4 of 13**
bigevent.io rows and **2 of 96** EventsEye rows sampled. §6 makes the cost of a generous grading small.

### 4. The field ladder

Each field of a rendered entry is taken from the cluster's records by running down this ladder and
stopping at the first step that leaves one record:

| | Step | |
|---|---|---|
| 1 | **Seen in the latest run** | If no record in the cluster was, every record is eligible — otherwise a quiet cluster would render empty. |
| 2 | **Has a real value** | `0001-01-01` and an empty `dates[]` are not values. |
| 3 | **More specific** | `Sands Expo, Hall D` beats a bare `Singapore`. |
| 4 | **First-hand** | ADR-0020's tiebreak. |
| 5 | **Earliest `firstSeenAt`** | |
| 6 | **Alphabetical by source key** | Arbitrary, deterministic, written down. |

**Step 1 is what makes the merge self-healing.** When the record holding a field stops appearing, the
field falls through to a live record on the next run; when it returns, it takes the field back. This
reads an observation — *was this row in today's scrape* — and does **not** infer a status from absence,
which `CONTEXT.md` § *Seen-tracking* forbids. ⚠️ A row that flickers in and out day to day makes a
value flip, and each flip bumps `sequence`, so subscribers see an update. Accepted: a visible flap
beats a silently frozen value.

**Step 3 before step 4 — specific beats authoritative.** Where Marina Bay Sands' own feed says
`Marina Bay Sands` and EventsEye says `Sands Expo and Convention Centre, Hall D`, the aggregator's
value wins. ADR-0020 says Provenance *"orders a merge rather than picking a winning record"*; a
tiebreak runs after the substantive rules, not before them. The risk — an aggregator inventing a hall
number is believed over the venue itself — is accepted, and is not separately flagged.

### 5. An equal-rank clash: first seen holds, and the admin is told

Steps 5 and 6 exist because the ladder must terminate, but reaching them means the model had no
substantive reason to prefer either value. So when two records that are **equally specific, equally
firm and of equal provenance** disagree — EventsEye says 12–14 Oct, bigevent.io says 13–15 Oct — the
earlier-seen value holds **and the disagreement is surfaced to the admin**, who can switch it.

**The flag does not block publication.** The calendar always shows something, and always the same
thing between runs.

**Only an equal-rank clash is flagged.** A disagreement the ladder settles at step 3 or 4 is resolved
silently — including one where a first-hand record loses.

This is the gap ADR-0020 named, closed. It is closed **without** a source ranking, which #128
considered and dropped: an ordered credibility list would have to be justified and kept current, and
the admin reviews entries by hand regardless.

### 6. What Provenance actually decides, stated plainly

**Step 4 of the ladder. Nothing else.**

#128's working phrase was that first-hand supplies *"existence and remit"*. Neither survives:

- **Existence** — §7 publishes a second-hand-only cluster on its own, so provenance decides nothing
  about whether an entry exists.
- **Remit** — whether an entry belongs on this calendar is the relevance verdict owned by
  [#116](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/116)/#120, not this axis.

So first-hand separates only two records that are already **equally specific and equally firm**, and it
loses to specificity outright. This is thinner than ADR-0020's wording implies and is recorded
deliberately: *"existence and remit"* is retired for the same reason *"only added if"* is — an
unactionable phrase left standing is how a dropped concept returns as an implementation shortcut.

ADR-0020's own sentence remains exactly true: Provenance *"exists for exactly one job: breaking ties …
and does no other work."*

### 7. Provenance is orthogonal to moderation

A cluster with **no first-hand record publishes on its own**, with no additional review. Tiering never
suppresses an entry for being second-hand.

This is priced, not assumed: MBS is 60% of EventsEye's rows and can never confirm beyond three days,
so **essentially the entire forward-dated trade-show calendar is second-hand-only**. A gate on *no
first-hand record* would queue the very coverage ADR-0020 was reversed to obtain.

The levers that already exist do this job better and stay: the **per-source default relevance verdict**
(#116/#120) can flag one weak source without indicting a category, and ADR-0020's **admin-facing
description** (`event aggregator`, `ticketing platform`) already shows a reviewer where an entry came
from.

### 8. The UID follows the founding record

A cluster's UID belongs to the record with the earliest `firstSeenAt` — the record it was minted
against. On any reshape:

- **Split** (the admin rules that two records are not the same event): the side still holding the
  founding record keeps the UID. The other side is a new cluster and mints a new one.
- **Join** (the admin spots a match we missed between two published clusters): the older UID survives.

This keeps ADR-0004 literally true — the UID is looked up by the record it was minted for, never
recomputed — and needs no human judgement.

⚠️ **A join necessarily retires a UID, and a subscriber loses that entry.** iCal has no merge
operation; there is no shape of this rule that avoids it. The rule can only decide *which* UID
survives, and does. Recorded here so it is a known cost rather than a bug report.

## Consequences

- **Nothing in the codebase changes shape.** `Source`, `Scraped`, `sourceKey` and the adapter seam
  (ADR-0004, ADR-0005) are untouched. The ladder is core merge logic that runs after `parse`.
- **The cluster is new persisted state** — it holds `uid` and `sequence`, which today sit on the record.
  Moving them is the concrete storage consequence, and it lands on
  [#117](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/117) (storage) and
  [#121](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/121) (the contract).
- **The admin surface gains one new flag type** — an equal-rank field disagreement — on #120's existing
  surface. It is a third thing a reviewer sees, after the relevance verdict (#116/#120) and #128's
  ambiguous-match verdict. **No new admin surface.**
- ⚠️ **The flag's volume is unmeasured.** #128 measured venue↔aggregator overlap at **14%** and recorded
  aggregator↔aggregator as *"the unmeasured part"*. §5 was chosen partly because it degrades safely
  when that number is large — the calendar renders either way and the queue is advisory — but the
  number is still not known, and #115 should measure it while settling the matching rule.
- **`CONTEXT.md` gains *Cluster* and its *Provenance* entry is narrowed** to name step 4 as the whole
  job.
- **Step 1 can bump `sequence` without any source changing its mind** — a flickering row moves a field
  and the feed reports an update. Visible by design; see §4.
- **#115 is handed a settled precedence model** and should not re-litigate it. The split holds:
  **#115 decides whether two records are the same; this ADR decides what follows.**

## Alternatives rejected

- **Admission-time dedup — "only added if not a duplicate".** The ticket's original phrasing. Rejected:
  a bad match would be unrecoverable, the evidence an aggregator ever published the row would be gone,
  and every per-source health signal would be corrupted by the missing rows.
- **A trust tier separate from Provenance.** Rejected as the second ranking axis ADR-0020 already
  considered and dropped, for its reason: the admin reviews entries by hand, so the axis would inform
  nothing the code does.
- **More than two tiers** (own premises / precinct / ticketing platform / directory). Rejected: no
  ruling in this ADR would come out differently, and it would cost a re-grading of all 21 sources to
  feed a step that only breaks ties between equals.
- **Per-record provenance, derived from a declared venue remit.** Correct in principle; rejected on
  data — it keys off the field most often blank. See §3.
- **An ordered source-credibility list to break equal-rank ties.** Rejected — see §5.
- **Send every equal-rank disagreement to the admin with nothing published meanwhile.** Rejected as
  unsized: aggregator dates drift constantly, the volume is unmeasured, and it would leave contested
  fields blank on a professional calendar.
- **The fuller record supplies the whole entry.** Rejected: contradicts #128's field-by-field merge and
  discards good fields from the thinner record.
- **Authoritative beats specific** (step 4 before step 3). Rejected: it makes the calendar
  systematically show less than it knows, and partly undoes #128's *prefer specific over vague*.
- **Fall through only after the holder has been absent for several runs.** Rejected: kills the flapping
  in §4, but the threshold would have to be chosen now with no data to choose it from.
- **Hold second-hand-only entries for review.** Rejected — see §7.
- **Fresh UIDs for both sides of a split.** Rejected: every subscriber loses two entries and gains two,
  for a correction affecting one.
- **Let the admin choose which side keeps the UID.** Rejected: a judgement call added to every split,
  with no rule to fall back on when the admin has no preference.
