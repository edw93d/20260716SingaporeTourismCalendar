# ADR-0013: The freshness alarm is an out-of-band watcher of the published artifact

- **Status:** Accepted
- **Date:** 2026-07-23
- **Ticket:** [#61](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/61)

## Context

The daily pipeline failed to publish for three days (2026-07-21 → 2026-07-23, #60) and
**nothing announced it**. The published calendar sat frozen at 2026-07-20 20:51 UTC while
every reader saw a page that rendered perfectly. The only signal was a red run in the
Actions tab — an *operational* signal, in a pipeline whose own header says that "nobody is
present when this fires, so every property it needs has to be structural rather than
operational."

Breakage detection (#41, ADR-0007) could not see it, and **not merely because it was not
looking**. It watches **Source health** — four signals, all about whether a source can
still be *read* — and during the outage every source read fine. What failed was the
publish step, which is not a source and has no health signal.

The deeper problem is positional: alerting runs inside `npm run pipeline`, which is the
step *before* `Commit the refreshed store and feeds`. **A step inside a job cannot report
that job's own failure.** A detector that runs before the failing step cannot observe that
step's failure however many signals you give it, and the same applies to the `deploy` step
after it. No amount of work inside the pipeline fixes this.

This is the product's own thesis turned on the pipeline: correct on the day it was
compiled, silently wrong afterwards.

## Decision

**A second workflow, on its own schedule, fetches the published calendar over HTTPS and
opens an issue when readers cannot get a current one.**

- **It watches the symptom, not any cause.** The alarm's subject is "the thing a reader
  reaches is old or missing," which is what `CONTEXT.md` § Freshness defines Freshness to
  be. Every cause therefore trips it identically — a failed run, a failed deploy, a
  dropped schedule, a run that never started, or branch protection quietly changing under
  the daily commit (ADR-0012).
- **The signal is a new `generatedAt` on `site/calendar.json`** — the run instant, written
  once per pipeline run.
- **The threshold is 48 hours**, tolerating exactly one missed run and alarming on the
  second.
- **It runs at 03:47 UTC**, about eight hours after the pipeline's 19:37.
- **It is entirely YAML and shell.** No checkout, no `npm`, no project code.
  `permissions: issues: write` and nothing else.
- **One open alarm at a time**, found by a hidden body marker, auto-closed with a comment
  when freshness returns.

### Why `generatedAt` and not something that already exists

`sources[].lastConfirmed` was already in the payload and looks like it would serve. It
does not: it is derived from `lastSeenAt`, so it **freezes when a scraper breaks**. An
alarm reading it fires on a calendar that published perfectly on time whenever a source is
down — and fires *in duplicate* with the #41 issue already open for that source. That is
the orthogonality `CONTEXT.md` § Freshness states, violated by the first convenient field.

The feeds' `DTSTAMP` is the run instant and has the right semantics, but it is per-`VEVENT`
(an empty feed carries none) and ADR-0011 has already parked a change making it the
last-revision instant instead. Building the alarm on it means the alarm breaks silently the
day that fix lands.

### Why 48 hours

`daily.yml`'s cron comment explicitly tolerates a dropped run: "A dropped run costs a day of
freshness and nothing else (the store is upserted, so the next run heals it)." An alarm that
fires on one miss alarms on something the design already accepted, and gets ignored.

The watcher fires a fixed offset after the pipeline, so the age it observes is offset + 24h
per missed run: **~8h healthy, ~32h after one miss, ~56h after two.** Anything strictly
between 32 and 56 separates them; 48 sits there with 16h of margin on both sides, absorbing
a late run or a slow deploy without approaching either boundary.

This is a relationship between *three* values — both crons and the threshold — so
`tests/workflow.test.ts` derives it rather than asserting the number, and additionally holds
that the offset clears the pipeline's own runtime. (Without that second guard, moving the
watcher to fire minutes after the pipeline *starts* keeps the arithmetic formally satisfied
while the watcher reads yesterday's artifact on a healthy day — the margin does not shrink,
it silently shifts. This was found by mutating the cron and watching the test stay green.)

### Why shell rather than `src/alerts`

There is a tested TypeScript alerter in `src/alerts/` that opens, dedups and auto-closes
issues. It is not reused.

1. **Independence is the entire property.** Reusing it means `actions/checkout`, `npm ci`,
   a working `tsconfig` and every dependency the pipeline has. A broken build is not
   independent of a broken pipeline — it is one of the likelier causes. A watcher that
   shares its target's failure modes goes quiet exactly when it is needed.
2. **`src/alerts` is keyed on `SourceId` throughout** — `findOpen(source)`,
   `markerFor(source)`, `issueTitle(source)`, the whole `reconcile` loop. Freshness is not
   a source. Reuse means widening a domain type to admit a non-source, corrupting the model
   to save some shell.
3. **The logic is genuinely smaller here.** One alarm, not one per source: no signal kinds,
   no late-signal append, no per-source fan-out, no `AggregateError`.

The `contents` scope is withheld for a second reason beyond least privilege: a watcher that
cannot write the repository cannot become the dummy-commit trick #19 bans. That is
foreclosed structurally rather than by the text scan.

## Consequences

- **The failure #60 exposed now announces itself**, on the morning of day 2, in the channel
  the operator already reads.
- **Up to ~2 days of silent staleness is accepted by design.** That is the price of not
  firing on the dropped run GitHub warns about, and #61 asked for it explicitly.
- **The alarm's open/close policy is not unit-tested.** `tests/alerts.test.ts` covers the
  equivalent logic for source health; this path has only the structural guards in
  `tests/workflow.test.ts`. Accepted as the cost of item 1 above — the shell was exercised
  against stubbed `curl`/`gh`/`date` across twelve paths (fresh, one miss, two misses,
  unreachable, missing field, unparseable field, lenient-date garbage, already-alarming,
  recovery, recovery with a failed `issue view`, a failed `issue list`, and an unrelated
  open issue) before landing, but that harness is not committed and does not run in CI.
  **Two of those paths were defects the review found**, both in the same shape: a `gh` call
  failing where the script assumed it could not. One left the alarm open forever on a
  healthy calendar *and* reddened the run; the other opened a duplicate issue. Every `gh`
  read is now retried and every failure has a named branch, because in this workflow an
  unhandled error is not a loud failure — it is silence.
- **A failed issue listing costs a day, by choice.** If the Issues API cannot be read after
  three attempts the run writes nothing rather than guessing, since guessing "no open
  alarm" opens duplicates and guessing the reverse suppresses real ones. The alarm
  re-checks tomorrow.
- **`gh issue list --limit 200` is not paginated**, matching `src/alerts/gh.ts`. Past 200
  open issues the marker scan would miss an existing alarm. Inherited from the existing
  alerter rather than introduced here, and far outside this repository's scale.
- **`site/calendar.json` now changes on every run**, as the feeds already do (ADR-0011).
  Bounded churn, beside a store blob that changes every run anyway.
- **Nothing watches the watcher.** If the platform drops *its* scheduled run, or the
  repository's 60-day inactivity disable turns it off, nothing notices. The mitigation is
  the keepalive #19 bans, and a third watcher only moves the regress. What makes it
  tolerable: the inactivity disable is repo-wide and the daily commit *is* activity, so a
  dead pipeline reaching 60 days would have alarmed on day 2 — both failures would have to
  coincide with the alarm already broken and ignored for two months. A single dropped
  watcher run costs a day of alarm latency, not the alarm.
- **The alarm can flap.** A pipeline that fails two days, works one, and fails two more
  opens, closes and reopens — two issues for one underlying fault. ADR-0007 accepted the
  same exposure for source health. Searching closed issues to reopen within a window would
  fix it, at the cost of the simplicity the shell path was chosen for.
- **A missing `generatedAt` alarms rather than being tolerated.** This makes the rollout
  ordered: the payload change must publish before the watcher's first scheduled run, done
  by dispatching the pipeline manually after merge. The alternative — a grace period for a
  missing field — buys one day of convenience for a permanent blind spot, which is #61's
  own bug reintroduced.
- **The published URL is now named in the repository.** It is the reader's own address, not
  out-of-band state like Pages-enabled (ADR-0011); a fork that renames the repo changes it.

## Alternatives rejected

- **An `if: failure()` job in `daily.yml`.** Cheap and in-tree, and it can name the failing
  step, which the symptom watcher cannot. But it is **blind to the run that never starts** —
  a dropped schedule or a disabled workflow — which is a real freshness failure, and GitHub
  disables schedules on inactive repositories. It detects a *cause*, and a proxy of the
  wrong thing: Freshness is defined as a property of the published artifact, not of a run
  outcome.
- **Both, the failure job for speed and the watcher as backstop.** The fast half buys hours
  of latency on a *daily* pipeline while adding a second alarm that fires on the same
  incident. Two issues for one fault is the fatigue `src/alerts/issues.ts` was written to
  avoid. Reconsider if diagnosis-in-the-alarm ever proves worth it.
- **Reading the committed `site/calendar.json` from a checkout** instead of fetching. The
  commit-back and the Pages deploy are separate steps that fail separately: this would have
  caught #60 and would not catch a failed deploy, while reporting fresh to the operator.
- **Letting the fetch fail the step** rather than handling it. A red run nobody watches is
  exactly #61's original bug, reproduced one level up.
