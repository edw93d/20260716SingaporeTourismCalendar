# ADR-0007: Breakage detection — the core watches the future-dated cohort for a net drop

- **Status:** Accepted
- **Date:** 2026-07-16
- **Ticket:** [#9](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/9)

## Context

ADR-0006 already answers most of "how does a scraper tell us it broke," and answers it
per-run, inside the parser: **anchor absent** (not our document), **`failures[]`
non-empty** (rows broke), **`ok: true, records: []`** (genuinely empty). Three signals
where there was one silence.

But ADR-0006 rules that anchor present + zero rows is *"genuinely empty. A fact."* — and
#9's hard case is the redesign where the anchor **still matches** and rows drop 40 → 3,
every surviving row parsing cleanly, `failures` empty, `ok: true`. ADR-0006 is
structurally incapable of catching that, by design: it reasoned that the parser is the
only code that cheaply knows what the document should look like, but **a parser sees
exactly one run.** It has no yesterday. That is the same observe/remember line ADR-0005
drew, and it lands the quiet failure squarely in the core.

The core is already holding the evidence. ADR-0004 keeps every record forever with
`firstSeenAt`/`lastSeenAt` and says so in as many words: seen-tracking *"gives breakage
detection (#9) its raw signal."*

## Decision

### 1. Drift detection lives in the core, from stored history

Not in the adapter. An adapter with a row-count floor is an adapter with an opinion about
yesterday, and ADR-0005 gave it no yesterday to have an opinion about. No new storage is
required — this reads what ADR-0004 already persists.

### 2. The unit is the **net** change in the **future-dated cohort**

A record has **vanished** when it was present in the previous run, is **still future-dated
now**, and is absent now. Appearances in the same run offset vanishings.

Both qualifiers are load-bearing:

- **Future-dated** — the sources publish *upcoming*, so a conference that merely happened
  leaves the cohort by exiting it, not by vanishing from it. Comparing the cohort rather
  than raw row counts is what makes the healthy baseline **net zero or positive** at every
  source, at every size.
- **Net** — this discriminates on precisely the axis that separates the two causes. A
  reschedule is one out, one in, net zero. A dead selector takes rows away and puts nothing
  back. This matters because **SCC is a built-in false-positive generator**: its
  `sourceKey` is `{vessel}|{arrivalDate}`, so a reschedule is *"a delete-plus-create, not a
  move"* (ADR-0004) — one vanish plus one appearance, 6% of a 16-row source, for an
  entirely healthy reason. Netting silences it **by construction**, not by tuning a
  threshold above it.

### 3. Threshold: a net drop of **≥3**, global across all sources

| Source | Future-dated cohort (#2) |
|---|---|
| Suntec | ~124 upcoming (of 154) |
| SCC | 16 sailings |
| MBCCS | unmeasured; cruise-scale |

An 8× spread, but size is the wrong denominator: the baseline is ~0 for all three, so a
percentage measures against nothing. On SCC's 16 rows a percentage also quantises into
6.25% steps, making any dial between 20% and 25% a fiction.

Against a zero baseline, the noise is −1 (a genuine cancellation) or −2 (two, same day).
The signal is −16 (SCC's selector dies) or −124 (Suntec's). **The gap is more than an order
of magnitude, so the exact threshold barely matters** — anything from 3 to 10 behaves
identically. That is the tell that per-source tuning buys precision that does not exist.

### 4. When `parse` returns `ok: false`, skip drift detection entirely

Anchor absent means zero records, which reads as a 100% net drop and would fire a second,
misleading alert about mass cancellation. The honest report is "the page isn't ours."

### 5. Transient fetch failures retry **inside** the run

A single HTTP 500 must not open an issue, but waiting for a second consecutive *daily* run
costs 48 hours of detection latency. Retry-with-backoff belongs in the **core-injected HTTP
client** — ADR-0005 already made that the adapter's only route to the network — so every
adapter inherits it and politeness stays structural. Post-retry, a fetch failure alerts on
the first run.

### 6. The alert is a **GitHub issue**, one open per source, auto-closed

Four signals reach the alerting layer: **fetch failed** (post-retry), **`ok: false`**,
**`failures[]` non-empty**, and **net drop ≥3**.

- **Identity is the source**, e.g. *"Scraper unhealthy: Singapore Cruise Centre."* All four
  signals land as comments on the one open issue. Identity matches the **operator's unit of
  action** — "open the SCC adapter and look at it" — and the signals are not independent
  anyway: a redesign trips the anchor *and* the row parser, one cause, one fix.
- **A break is stateful, and an issue is the only channel here that has state.** It opens,
  gets triaged, closes when fixed. The pipeline runs daily, so a stateless channel emits
  one identical message per day per break; dedup would become something the operator does
  by ignoring repeats.
- **Auto-close on the next healthy run**, with a closing comment. A transient Imperva
  challenge — the likeliest break, per #2's *"passive today, but a switch they can flip"* —
  self-resolves without manufacturing manual work.

### 7. An alert **never** writes into the domain model

There is no `status: broken` field on a record. ADR-0004 refuses to resolve absence into a
status the source never stated, and detecting breakage does not quietly reverse that: a
cross-run drop is a **suspicion**, and it is addressed to the operator, not to the data.

## Consequences

- **The quiet 40 → 3 redesign is caught the morning it happens**, which ADR-0006 could not
  do alone.
- **SCC's known `sourceKey` flaw stops being an alerting problem** without a per-source
  exception.
- **This constrains #10 (stack & hosting) rather than blocking on it.** Issue-based
  alerting costs **zero credentials** *only* on GitHub Actions, which injects
  `GITHUB_TOKEN` automatically. Anywhere else, v1 provisions a PAT — spending the
  zero-credential property that #8 established. #10 inherits this as a stated pressure.
- **Flapping is visible without a flap guard.** Every open-and-close leaves a permanent
  closed issue, so six flaps are six closed issues, found with one `gh issue list
  --state closed`. A guard would need a tuning parameter with zero runs to calibrate it.
- **The reader's loop stays open.** All of this fixes the *operator's* awareness. Between
  the 3am break and the fix, the calendar still serves records whose `lastSeenAt` stopped
  advancing, and says nothing. That is #17, deliberately separate.
- **Cold start is silent**: the first run for a source has no previous cohort, so no drift
  signal. Correct — there is nothing to compare.

## Alternatives rejected

- **Per-source row-count floors in the adapter** — contradicts ADR-0005's central split.
  The adapter observes; it has no memory to threshold against.
- **Proportional thresholds** — calibrated against total size when the baseline is zero, so
  the denominator is wrong; and unusable on a 16-row source, where percentages quantise
  into 6.25% jumps.
- **Alerting on *any* vanished future-dated record** — SCC reschedules trip it routinely.
  Trains the operator to ignore it within a fortnight.
- **A daily digest** — this project exists to *stop* reading sources by hand each morning.
  A digest swaps scraping-by-hand for reviewing-by-hand, and a report that is fine 364 days
  a year is a report nobody reads by week three. Alert fatigue in a smaller costume.
- **Email** — stateless; five days of one break is five messages.
- **stdout/logs, host does the alerting** — logs nobody reads *are* the silent-staleness
  failure, with extra steps.
- **One issue per bad run** — a five-day break files five issues; same problem as email.
- **Never auto-close** — makes the likeliest break (a transient WAF challenge) into
  guaranteed manual work, training the operator to close issues without reading them.

## Known gap, accepted

A redesign that replaces 40 real rows with 40 junk-but-parseable rows nets to zero and
stays silent. Accepted: ADR-0006's anchor catches the redesign case, and junk that still
satisfies a typed parser and a structural anchor is a narrow target.
