✅ **Current** — measured 05 Aug 2026 for [#115](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/115), the number [ADR-0022](../adr/0022-the-cluster-and-the-field-ladder.md) recorded as owed. It is a **one-day snapshot of three sources**, and every threshold below is calibrated against it; see §7 before reusing a number.

# How much do the aggregators actually duplicate each other?

[#128](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/128) measured
venue↔aggregator overlap at **14%** and recorded aggregator↔aggregator as *"the unmeasured
part"*. [ADR-0022](../adr/0022-the-cluster-and-the-field-ladder.md) inherited the gap and handed
it to #115, because it prices two things: the admin's ambiguous-match queue, and the equal-rank
clash flag.

This is that measurement. **The headline number is small — and it turned out to be the least
interesting thing in the data.** Three findings underneath it reshaped the matching rule, and
two of them are about duplication that is not cross-source at all.

## 1. What was fetched

05 Aug 2026, live, `http-scrape` route per
[`source-register.md`](../source-register.md) — all three are recorded `not-barred`.

| Source | Fetched | Rows | Firm-dated | Soft-dated | No venue |
|---|---|---|---|---|---|
| **EventsEye** | 22 month pages, Aug 2026 → May 2028 | **168** | 89 | 79 | 2 |
| **bigevent.io** | 1 page (JSON-LD `ItemList`) | **13** | 13 | 0 | 4 |
| **TTGmice** | 1 page, Singapore rows of 122 pan-Asian | **13** | 12 | 1 | 1 |

EventsEye's 168 is after collapsing 15 rows that repeat verbatim across month pages. **Soft-dated**
means the source names a month but no day — `Sept. 2027 (?)`. It is 47% of EventsEye.

## 2. The headline: cross-source overlap is small

Pairs whose titles are identical after normalisation (§6) and whose dates overlap:

| Pair | Matches |
|---|---|
| EventsEye × bigevent.io | **5** |
| EventsEye × TTGmice | **0** |
| bigevent.io × TTGmice | **0** |

**5 cross-source duplicates across 194 rows.** #113 predicted bigevent.io *"will duplicate
EventsEye and TTGmice heavily"*. Against EventsEye that is directionally right — 5 of
bigevent.io's 13 rows — but in absolute terms it is five rows, and against TTGmice it is zero.

TTGmice is the reason. It is a *pan-Asian* trade calendar of which Singapore is a minority, and
the 13 Singapore rows it does carry are the largest shows only. It barely intersects the other
two.

## 3. ⚠️ The commonest duplicate is inside one source, and it is next year's edition

EventsEye publishes the following year's run of an annual show as its own row, a year ahead, with
no firm date:

```
BEX ASIA   page 2026-Sep   02–04 Sep 2026   Marina Bay Sands
BEX ASIA   page 2027-Sep   (no firm date)   Marina Bay Sands
```

**61 of EventsEye's 79 soft-dated rows are this** — the next edition of a show EventsEye also
lists with a firm date. Identical title, identical venue, and **nothing to disagree about**,
because one side has no date.

This is the false-join case, and it is the expensive direction: a join retires a UID and costs a
subscriber an entry (ADR-0022 §8). Any rule keyed on title + venue joins these two, and they are
**different real-world events a year apart**.

It is why #115 ruled **no date, no cluster**.

## 4. ⚠️ Venue + date is not a match signal

**40 of EventsEye's 89 firm-dated rows sit in a `(venue, start, end)` slot shared with a
different show.** 11 slots collide; the worst are complete:

```
02–04 Sep 2026, Marina Bay Sands — 6 shows
   BEX ASIA · IBEW · INNOBUILD (IB) ASIA · MCE ASIA
   SEAFOOD EXPO ASIA · SMART CITIES & BUILDINGS (SCB) ASIA

29–30 Sep 2026, Marina Bay Sands — 6 shows
   BIG DATA & AI WORLD ASIA · CLOUD EXPO ASIA · CYBER SECURITY WORLD ASIA
   DATA CENTRE WORLD ASIA · ECOMMERCE EXPO ASIA · TECH WEEK SINGAPORE

10–12 Nov 2026, Marina Bay Sands — 6 shows
20–23 Apr 2027, Singapore EXPO — 5 shows
```

Co-location is how these venues work. Venue and date agreeing carries **no** evidence that two
records describe the same event.

## 5. Where duplicates exist, half of them are unreachable by title

Every pair whose dates overlap and whose titles are *close but not identical*, judged by eye:

| Score | Pair | Same show? |
|---|---|---|
| 0.97 | `SINGAPORE AIRSHOW` / `Singapore Air Show` | ✅ |
| 0.91 | `STAINLESS STEEL WORLD ASIA … EXHIBITION` / `… EXPO` | ✅ |
| 0.85 | `THE FIRE SAFETY EVENT - ASIA` / `THE HEALTH & SAFETY EVENT ASIA` | ❌ |
| 0.80 | `FHA - FOOD & BEVERAGE ASIA` / `FOOD & BEVERAGE FAIR` | ❌ |
| 0.75 | `BEX ASIA` / `MCE ASIA` | ❌ |
| 0.74 | `INTER AIRPORT SOUTH EAST ASIA` / `Inter Airport SEA` | ✅ |
| 0.73 | `BIG DATA & AI WORLD ASIA` / `DATA CENTRE WORLD - ASIA` | ❌ |
| 0.71 | `THE HEALTH & SAFETY EVENT ASIA` / `THE SECURITY EVENT ASIA` | ❌ |
| 0.69 | `ACCOUNTING BUSINESS EXPO - ASIA` / `Accounting and Finance Show Asia` | ✅ probably — a rename |
| 0.67 | `THE MEETINGS SHOW - ASIA PACIFIC` / `Business Travel Show Asia Pacific` | ❓ sister shows |
| 0.52 | `ITB ASIA` / `ITB Asia/MICE Show Asia 2026` | ✅ |

**There is no threshold that separates these.** `Inter Airport SEA` (a real duplicate, 0.74) scores
*below* `THE FIRE SAFETY EVENT - ASIA` / `THE HEALTH & SAFETY EVENT ASIA` (not a duplicate, 0.85).
The cause is structural: Singapore trade-show titles are overwhelmingly `<TOPIC> ASIA`, and
co-located siblings are *designed* to look alike.

How many pairs land in front of a reviewer, by cutoff, across the whole 21-month corpus:

| Cutoff | Pairs | Per month |
|---|---|---|
| 0.90 | 2 | 0.1 |
| 0.80 | 4 | 0.2 |
| 0.70 | 13 | 0.6 |
| **0.50** | **48** | **2.3** |
| 0.40 | 77 | 3.7 |
| every pair sharing dates | 220 | 10.5 |

**Below 0.50 nothing real appears.** The 0.40–0.48 band is 29 pairs and entirely co-located
siblings — `BEX ASIA` / `INNOBUILD (IB) ASIA`, `THE SECURITY EVENT ASIA` / `TOC CONTAINER SUPPLY
CHAIN ASIA`. #115 set the queue at **0.50** on this basis.

⚠️ **Pairs, not entries.** A slot with *n* co-located shows generates *n(n−1)/2* pairs. The three
6-show slots in §4 account for 45 pairs between them. **The queue grows quadratically in
co-location, not linearly in calendar size.**

## 6. Normalisation: conservative, or it destroys the data

Titles are compared after: Unicode NFKD and accent-strip, curly→straight quotes, case-fold, remove
a four-digit year anywhere, replace non-alphanumerics with spaces, collapse whitespace.

⚠️ **Domain words must not be stripped.** A first pass dropped `asia`, `expo`, `week`, `singapore`,
`show`, `conference` as noise. It collapsed `TECH WEEK SINGAPORE` and `ASIA TECH X SINGAPORE` to
the same key — two different shows eight months apart — and merged four of the six co-located
shows in each §4 slot. **In this corpus those words are the title.** The finding is recorded
because the idea is an obvious one to have twice.

Conservative normalisation yields **7 exact-match joins**, of which **2 are EventsEye against
itself**:

```
[eventseye] SEA ASIA                   ×  [eventseye] SEA-ASIA                  16–18 Mar 2027
[eventseye] THE SECURITY EVENT - ASIA  ×  [eventseye] THE SECURITY EVENT ASIA   10–12 Nov 2026
[eventseye] BEX ASIA                   ×  [bigevent ] BEX Asia                  02–04 Sep 2026
[eventseye] DRONES & UNCREWED ASIA     ×  [bigevent ] Drones & Uncrewed Asia    17–18 Mar 2027
[eventseye] GEO CONNECT ASIA           ×  [bigevent ] Geo Connect Asia          17–18 Mar 2027
[eventseye] THE BUSINESS SHOW - ASIA   ×  [bigevent ] The Business Show Asia    26–27 Aug 2026
[eventseye] ASIA TECH X SINGAPORE      ×  [bigevent ] Asia Tech x Singapore     26–28 May 2027
```

Nearly a third of what the rule catches is one source duplicating itself. This is why #115 ruled
matching **source-blind**.

**No chaining occurs.** All 7 joins are simple pairs; no cluster of three forms. With 3 sources
transitivity is theoretical — at 21 it will not be.

## 7. Same title, different dates: a clean bimodal split

Every same-title pair where **both** sides carry a firm date:

```
    0d   SEA ASIA / SEA-ASIA                        same event, two spellings
    0d   STAINLESS STEEL WORLD ASIA (listed twice)  same event
    0d   THE SECURITY EVENT - ASIA / ... ASIA       same event
   28d   SEA Asia — EventsEye 16 Mar 2027 vs TTGmice 13 Apr 2027    one source is stale
  190d   ECOMMERCE EXPO ASIA    29 Sep 2026 vs 07 Apr 2027          different editions
  364d   WORLD'S LEADING WINES  23 Oct 2026 vs 22 Oct 2027          different editions
```

**Nothing lies between 28 days and 190 days.** #115's ~60-day window sits in that gap, and any
value from roughly 40 to 180 days behaves identically on this data. ⚠️ The 190-day case matters:
editions are **not** reliably 12 months apart, so the window cannot be widened toward a year.

## 8. A record key that survives a soft date firming up

Not #115's decision — ADR-0004 makes `sourceKey` the adapter's — but measured here because §3
makes it load-bearing. EventsEye has no native identifier; #113 records it as having *"nothing but
name + date + venue"*.

If the key embeds the **exact date**, a soft date firming up (`Sept. 2027 (?)` → `09/02/2027`)
produces a *new record*. The old one is abandoned, its UID retires, and the subscriber loses the
entry and gains another. **61 rows are in that state right now.** It is ADR-0004's recorded `scc`
reschedule flaw, at a third of the highest-volume source on the list.

Keying on **title + venue + year** instead was tested against the corpus:

| | |
|---|---|
| Rows | 168 |
| Distinct keys | **165** |
| Collisions | **3** — and all 3 are genuine duplicates (`SEA ASIA`/`SEA-ASIA`, `THE SECURITY EVENT` ×2 in two different years) |

It collapses exactly what should collapse, and firming a date becomes an in-place update. A show
that reschedules across a New Year still splits; that is rarer than the case it fixes.

## 9. Method, and what would invalidate this

Fetched with `curl`, plain `GET`, browser User-Agent, 1s between requests, HTTP/1.1 pinned for
bigevent.io per #113's Cloudflare note. EventsEye was fetched as **22 month pages** selected by the
`_0`/`_1`/`_2` year index, and **each page's `<title>` was trusted over its URL**, per #113's
silent-fallback trap. All 22 resolved to a distinct month; row counts were checked against each
page's own `<caption>` and agree. The corpus is **183 rows before de-duplication**, which matches
#113's independently-derived *183 listed* exactly. February 2027 is a genuinely empty page.

Similarity is Python `difflib.SequenceMatcher` ratio over the normalised titles.

⚠️ **Every threshold here is calibrated to that one function against this one corpus.** 0.50 and
0.90 are not properties of the world. A different comparison method — token-set, Jaro-Winkler,
embeddings — needs recalibrating from scratch, and the number is meaningless without the method
recorded beside it.

**What would change the conclusions:**

- **A fourth aggregator.** Three sources is a thin base for a claim about overlap, and TTGmice's
  zero is really a statement about TTGmice's Singapore coverage, not about aggregators.
- **Any source with a different title convention.** The `<TOPIC> ASIA` monoculture is what makes
  co-located siblings score so high; a consumer-events source would not behave this way.
- **Consumer sources are entirely absent.** Eventbrite, SISTIC and Ticketmaster are on the source
  list and publish a different kind of thing at a different volume — SISTIC alone carries **284
  discrete events, 88% unique to it** (#131). Nothing here predicts how they behave.
- **Venue↔aggregator overlap is still #128's 14%** and was not re-measured here.
