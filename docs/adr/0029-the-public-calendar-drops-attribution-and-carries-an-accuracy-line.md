# ADR-0029: The public calendar drops attribution, and carries an accuracy line

- **Status:** Accepted
- **Date:** 2026-08-06
- **Ticket:** [#145](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/145)
- **Narrows [ADR-0021](0021-reading-sources-that-forbid-it.md) §1** — the *with attribution* limb is
  **not honoured on the v2 public calendar**, deliberately. §1's rule stands whole for every other
  limb (facts-only, politeness, permission-in-parallel) and every other surface; only the
  attribution obligation, as applied to the served web calendar, is set aside here. See Decision §1.
- **Answers [ADR-0026](0026-v2-publishes-the-code-and-the-calendar-are-public-the-data-leaves-the-repository.md)
  §8's second failure class and its two Consequences** — the *with attribution* limb going live, and
  the *stated-limitations line*. Both were raised on this ticket; both are ruled here.
- **Amends [ADR-0014](0014-web-calendar-presentation-refinements-uiux-round-1.md) §2** — the
  methodology footer gains one more caveat line, on the same *"disclosed, not surfaced"* footing it
  already carries the freshness, coverage and facts-only caveats under. See Decision §2.
- **Register:** no change to [`docs/source-register.md`](../source-register.md). This ADR does not
  touch what is read, stored or permitted — only what the served page shows.

## Context

[ADR-0026](0026-v2-publishes-the-code-and-the-calendar-are-public-the-data-leaves-the-repository.md)
made v2 publish, and in doing so switched on two things that had been dormant while the calendar was
assumed private. Both land on the same surface — the served web calendar page — so they are one
ticket.

1. **ADR-0021 §1's *with attribution* limb went live for the first time.** It was written once for
   the whole project and never exercised, because v2 was thought not to republish. ADR-0026 §5 records
   it stopped being a courtesy on 06 Aug 2026.
2. **ADR-0026 §8 split what a junk row costs**, and one half — *a wrong date the parser misread* — has
   no moderation answer. Reviewing catches an irrelevant record; it cannot catch a Tuesday read as a
   Wednesday. ADR-0026 §8 named the only available mitigation: *a stated-limitations line on the page.*

### What the page shows today

- **The source is a bare code.** `src/site/payload.ts` carries `source: SourceId` on every record,
  and `site/calendar.js` renders it as the entry's chip — the raw id (`suntec`, `scc`, `mbccs`), a
  label meaningful to the operator and to nobody else. #38 put it there; ADR-0024 keeps it, because
  *duplicates are accepted and labelled by source* and the code is what tells two copies apart.
- **There is already a caveat home.** ADR-0014 §2 built a *Methodology notes* footer (#79) and ruled
  caveats live there, **demoted out of prime real estate** — *"disclosed, not surfaced."* It already
  carries three: freshness (*"only ever as current as the last confirmation"*), coverage (*"not yet a
  complete picture"*) and facts-only (*"names, dates, venues, as published"*). It does **not** carry
  an accuracy caveat — *"as published"* asserts a faithful copy, not that the copy might be wrong.

### The scope of *attribution*, priced

Attribution has four tiers, and only the last is an ingestion-seam change:

| Tier | Reader learns source? | Sends traffic? | Cost |
|---|---|---|---|
| Bare code (today) | No | No | — |
| Human-readable **name** | Yes | No | Static `SourceId → name` map — manifest only |
| Name **+ per-source link** to the listing | Yes | Yes | One URL per source — **already in the register** |
| Per-**record** deep link | Yes | Yes | New `Scraped<T>` field, adapter change across every source, a migration |

The first three cost no adapter change and no migration; the register already holds each source's
listing URL, so a name-plus-link discharges attribution at manifest-only cost. Only the per-record
deep link is a genuine change to the ingestion seam, and it is not the cheapest way to honour §1.

**Attribution is a conduct term, not a copyright one.** Facts carry no copyright (ADR-0002,
ADR-0021 §1) — that is the whole load-bearing limb. So attribution discharges no duty to a
rights-holder; it is a good-faith gesture toward the source, and where it is a link, it is the thing
that turns *using someone's facts* into *sending them traffic*. Notably, ADR-0026 §5's enumeration of
the **surviving legal defence** — facts-only, politeness, honest identification, `robots.txt`, the
five hard stops — **does not list attribution.** It is the soft limb, not a load-bearing plank.

## Decision

### 1. The public calendar drops attribution — deliberately, with the cost in view

**Ed's ruling, 06 Aug 2026.** The served web calendar credits no source. The entry chip keeps its
short code, but the code stays for the ADR-0024 duplicate-labelling reason, **not** as attribution —
a bare code credits nobody. No human-readable name, no per-source link, no per-record link ships on
the public page.

**This narrows ADR-0021 §1.** The *with attribution* limb is set aside for the v2 public calendar.
Every other limb of §1 is untouched, and attribution is not dropped from the project — it is dropped
from *this surface, this version.*

**Why it is a defensible drop and not a reckless one:**

- Attribution is the **soft limb**. ADR-0026 §5 does not count it among the surviving legal defences;
  those (facts-only, politeness, honest identification, `robots.txt`, the five hard stops) are
  untouched and each still does its work.
- What is actually lost is the **traffic-back gesture** — the calendar uses sources' facts and returns
  nothing to them. That is the honest cost, and it is named rather than argued away.
- It is **cheap to reinstate**. A name-plus-link is manifest-only (§ Context), so parking it forfeits
  no future option and rebuilds nothing.

**The Sources list is parked as a KIV on the admin page**, not the public one. A code → name → link
mapping belongs where the operator can click through to a source's own listing to judge whether a
scraped event is relevant — the moderation surface (#116/#120), not the reader's calendar. It is a
kept-in-view convenience, not scheduled work.

⚠️ **The "audience doesn't care about the source" reasoning is true but adjacent.** It is a sound
reason to keep attribution *off the reader's calendar*; it is not what justifies dropping it entirely.
The justification is the two points above — soft limb, cheap to restore. The distinction is recorded
so the drop is not later mistaken for a UI-space call.

### 2. The accuracy caveat is one line in the existing methodology footer

**Ed's ruling.** The *Methodology notes* footer (#79, ADR-0014 §2) gains one more sentence, to the
effect of:

> *Collected automatically from public listings; may be inaccurate — check with the venue.*

It sits beside the freshness, coverage and facts-only caveats already there, on ADR-0014 §2's same
*"disclosed, not surfaced"* footing.

- **Generic — no source names.** Naming sources is per-entry noise and belongs with attribution,
  which §1 above drops. The caveat stays one short generic sentence.
- **Not pinned, not in the entry pop-up.** It is a footer line, not above-the-fold and not
  contextual.

**Why the footer beats the pop-up**, though the pop-up would be read at the point a user commits to a
date:

- ADR-0014 §2 **already decided** caveats live in this footer, demoted on purpose. Adding a fourth
  matches an accepted ruling rather than breaking it.
- It is **one sentence, no new UI** — proportionate to what ADR-0026 §8 calls a mitigation that
  *"costs a sentence."*
- The mitigation is **best-effort, not a fix.** No placement prevents the harm — a misparsed date
  cannot be caught by moderation and is not caught by a disclaimer either; the line lowers reliance,
  it does not remove the error. Spending a per-entry build on a warning that cannot prevent the harm
  is more than the problem warrants.

⚠️ **The "footer-blind" cost is real and accepted.** A footer sentence is less likely to be read than
a warning in the pop-up. It is accepted because the caveat is a proportionate best-effort disclosure,
not a guarantee — see above.

## Consequences

- **`site/index.html` gains one sentence** in the `.methodology` `<p class="note">`, beside the
  existing caveats. No `calendar.js` change, no payload change, no schema change. This is the whole of
  the build this ADR asks for.
- **The entry chip is unchanged.** `site/calendar.js` keeps rendering `source: SourceId` as the code.
  It is now explicitly a duplicate-distinguishing label (ADR-0024), not attribution.
- **No adapter, no `Scraped<T>` field, no migration.** The per-record deep link — the only tier that
  would have needed them — is not built. #121/ADR-0027's ingestion seam is untouched by this ticket.
- **`docs/source-register.md` is unchanged.** Attribution was never a register fact; the register
  governs what is read, stored and permitted, none of which moves here.
- **A KIV lands on the admin page**, not a ticket: a Sources list (code → name → link) for the
  operator, drawing its links from the register, useful to #116/#120 moderation. Unscheduled.
- ✅ **`/to-spec` reads this as:** the public calendar ships with *no attribution* and *one generic
  accuracy line in the methodology footer*; the entry code stays for duplicate-labelling; the admin
  Sources list is deferred. Nothing here gates the launch.

### Reopen trigger

- **A source objects to being used without credit.** Attribution is manifest-only to add back
  (name + per-source link from the register), so this is a cheap reversal — and an objection is
  already a full register re-read under ADR-0021 §8.
- **Revenue of any kind**, which under ADR-0026's reopen trigger re-prices the whole publication
  footing — the freeloading-without-credit posture reads differently once money is attached.
- **The accuracy line is seen to fail in practice** — a wrong date causes real harm and the footer
  caveat is shown not to have been read. Then promote it to the entry pop-up (Decision §2's rejected
  alternative).

## Alternatives rejected

- **Attributing on the public calendar — name, or name-plus-link.** The cheap, honest option:
  manifest-only, links already in the register, and it honours §1's live limb. Rejected by Ed — the
  reader does not want it and the limb is soft. Recorded first because it is the near miss, and
  because it is what a reopen would adopt.
- **A per-record deep link.** The richest attribution and the only tier needing an adapter change and
  a migration. Rejected as disproportionate even before attribution was dropped — it is not the
  cheapest way to honour §1, so it was never the question.
- **Keeping the code in the cell *as* attribution.** Rejected: a bare internal id credits nobody, so
  it discharges §1 in name only. The code stays for a different, real reason (ADR-0024
  duplicate-labelling).
- **The accuracy caveat in the entry pop-up.** Read at the point of decision, which the footer is not.
  Rejected — it is a new UI for a best-effort disclosure that cannot prevent the harm, and it breaks
  ADR-0014 §2's accepted "caveats live in the footer" ruling. Held as the reopen path if the footer
  line proves unread.
- **Naming sources in the accuracy line.** Rejected — per-entry noise, and attribution (where names
  would belong) is dropped anyway. The line stays generic.
- **A pinned, above-the-fold caveat.** Rejected on space: #96 records the phone header already taking
  26–39% of the viewport and #102 the grid already cramped. A footer line costs neither.
