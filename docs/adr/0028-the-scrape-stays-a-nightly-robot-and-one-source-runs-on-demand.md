# ADR-0028: The scrape stays a nightly robot, and one source runs on demand

- **Status:** Accepted
- **Date:** 2026-08-06
- **Ticket:** [#122](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/122)
- **Confirms [ADR-0025](0025-the-store-is-a-service-and-v2-ships-the-web-only.md) §1** — the daily
  scrape stays in GitHub Actions and reaches Postgres over the network; the server does not scrape.
- **Confirms [ADR-0007](0007-breakage-detection-net-drop-of-the-future-dated-cohort.md)** — the
  auto-managed issue per broken source remains the operator's status surface at twenty sources.
- **Confirms [ADR-0027](0027-the-source-contract-survives-twenty-sources.md)** — per-source failure
  isolation is the sequential loop's and the per-source transaction's, and is unchanged.
- **Amends [ADR-0005](0005-source-adapter-interface.md)** (Amendment 6) — the headless browser is
  launched only when a source in the run declares it needs one, not once per run. The `Source`
  contract, `FetchDeps` and the registry array are unchanged in shape.
- **Amends [ADR-0013](0013-the-freshness-alarm-is-an-out-of-band-watcher.md)** — the freshness
  watcher reads `generatedAt` from the **live-served payload** rather than a committed file, and only
  a **full** run advances it.

## Context

The complaint that started v2 was operational: troubleshooting anything triggered a full scrape of
every source, because `src/main.ts` hands the whole registry to `runPipeline` and every invocation
reads everything. That is true about the *run* and false about the *data* — the store is persistent,
upsert is by `(source, sourceKey)`, nothing is deleted, and v1's feeds were re-emitted from the store
rather than from the scrape, so a record absent from today's scrape still appeared in today's output.
The cost of a full run is time and politeness budget, not data.

#122 asked how a single source is read on demand, what sets each source's frequency, what triggers
runs now that charting settled *there is now a server*, what one source failing does to the others,
whether the browser is still launched for every run, where per-source run status and history live, and
whether anything still emits static artifacts.

Several of those were already answered by the standing constraints and by prior ADRs; this ADR records
which, and rules on the remainder. The through-line of every ruling is Ed's scope call: **v2 ships the
smallest scheduling model that fixes the founding complaint, and treats everything richer as a later
optimization with a reopen trigger.**

## Decision

### 1. Frequency is one shared nightly cadence. Per-source cadence is not built

Every source is read on one schedule — the existing nightly run. There is **no per-source frequency**:
no source is read weekly because its window is stale, none hourly because its inventory moves.

The research (#113) surfaced nothing that moves faster than a daily run already serves: the
fastest-changing things on the list are Changi's fixed one-month flight window and MBS's rolling
three-day directory, both refreshed adequately once a night. A per-source scheduler holding a next-run
time per source is machinery bought against a need no source on the list demonstrates.

⚠️ **Reopen trigger:** a source arrives whose data genuinely churns faster than daily, or the full run
grows too slow or too impolite to run whole every night. Either forces a fresh decision, not a silent
addition of a scheduler.

### 2. The scrape stays a nightly GitHub Actions run. The server does not scrape

*There is now a server* (ADR-0024) did **not** move scraping onto it. The server's remit stays the
admin page and serving the calendar's live reads (ADR-0025 §4). The nightly scrape stays in GitHub
Actions, writing to Postgres over the network.

This was put to Ed as a runtime fork against moving the scrape onto the server. Moving it was rejected
on cost, not principle: the server would have to carry a headless browser for the two sources that need
one (ADR-0027 — MBS and MBCCS), stay sized for a batch workload, and juggle scraping against serving
requests, giving up GitHub's free scheduled compute. ADR-0025 §2 had already chosen Postgres over
SQLite-on-a-disk **specifically to keep the scrape in GitHub Actions**; this ruling spends that room as
intended rather than reopening it.

### 3. A single source is run on demand by naming it on the existing trigger

The nightly workflow gains an optional "which source?" input. Empty reads the whole registry, as today.
A source id reads **only** that source.

This is the founding complaint's direct fix, and it is small: the run already reads sources through a
sequential loop over the registry array, so a single-source run is that loop over a one-element subset.
No new runtime, no new trigger surface — the on-demand path is `workflow_dispatch` with an input.

⚠️ **The trigger lives in the Actions UI, not the admin page.** A button on the admin page that calls
the dispatch API is a coherent later addition and is declined now as decided-correctness — for a
one-operator MVP, dispatching a workflow with an input is enough. Reopens if the Actions-UI trigger
proves to be friction in practice.

### 4. On-demand and nightly runs queue. They never overlap

A by-hand run and the nightly run serialize — one scrape at a time — carried by the existing
`concurrency: daily-pipeline, cancel-in-progress: false` group, which now serializes the on-demand path
too.

Two concurrent scrapes were rejected because ADR-0007's net-drop detection compares a source's cohort
against the store's memory **before** the run's own upserts land; two runs writing at once can read
each other's partial writes and raise a false breakage signal. Queuing costs a by-hand run a few
minutes behind the nightly, which at one operator is nothing. `cancel-in-progress: false` is retained
for its original reason — a cancelled run may already have upserted, and killing it between the
transaction and its completion is a way to lose a scrape actually made.

### 5. One source failing does nothing to the others — unchanged

This was already settled and is confirmed, not redesigned. The pipeline reads sources sequentially and
writes **one transaction per source** (ADR-0027, ADR-0006, ADR-0025 §5): a source that throws or breaks
mid-write rolls back its own rows and no others, and no other source's `lastSeenAt` is touched. A
single-source run inherits the same isolation trivially — it is the same loop over one element.

### 6. The browser is launched only when a source in the run needs one

The headless browser is no longer launched once per run. Each source declares whether it needs a
browser — a flat property read before the run, sitting alongside the manifest metadata a source already
carries (its provenance and admin description, ADR-0020/0027), **not** part of the `fetch`/`parse`
contract. The runner launches Chromium only if the selected sources include one that declares the need,
and closes it in a `finally` exactly as `src/main.ts` does today.

A full nightly run includes MBS/MBCCS, so it launches Chromium once, as now. A by-hand run of a
browser-less source — the common troubleshooting case — boots no browser at all, and needs no Chromium
installed for that path.

This amends ADR-0005's arrangement, where the entry point owns the browser lifecycle and launches it
unconditionally. Lifecycle ownership stays at the entry point; only the launch becomes conditional on
the run's declared needs. It does not touch the injection rule — an adapter that does not destructure
`browser` from `FetchDeps` still cannot acquire one.

### 7. Breakage stays visible as one auto-managed issue per source

ADR-0007's mechanism is the answer to #122's *"where is a broken adapter visible without reading
logs?"* and is confirmed unchanged: a broken source opens a GitHub issue, a recovered source closes it,
one issue per source. It is per-source and scales from three sources to twenty without change — the
issues list *is* the glanceable status surface.

A by-hand re-read of a broken source reconciles that source's issue like any other run, so poking a
source that has recovered closes its issue for free.

⚠️ **No persistent run history, and no admin-page health panel, is built.** An open issue reports the
current state, not a track record; #122 named history as a want and it is declined for the MVP.
Reopens if run history is actually wanted, or the issues-list surface grows noisy at twenty sources —
at which point a per-source status record in Postgres surfaced on the admin page is the shape to build,
now that a server and a database exist to hold it.

### 8. The freshness watcher reads the live-served payload, and only a full run refreshes it

ADR-0013's watcher fetched the *committed* artifact and read its `generatedAt`. v2 publishes no
artifact (§9), so the watcher is re-pointed at the **live-served payload** the server hands the browser,
which carries `generatedAt` as the committed file did. The mechanism is unchanged — an independent
outsider fetches the reader-facing thing and alarms when its timestamp is too old — and its independence
property sharpens: it now watches the exact thing a reader reaches. Server down → reader and watcher
both get nothing → it alarms. Server up but the nightly run stopped → the timestamp freezes → it
alarms. Both are correct.

⚠️ **Only a full run advances `generatedAt`.** A by-hand single-source run leaves the freshness clock
untouched. Otherwise poking one source would bump "last refreshed" and mask a dead nightly run — which
is precisely the silent-staleness failure (#60/#61) this watcher exists to catch. The 48-hour threshold
and its cron-offset arithmetic (ADR-0013) are unaffected: the nightly cron is unchanged.

### 9. Nothing emits a static artifact. The run is a pure writer

Confirmed from ADR-0025 §4 and ADR-0026: the daily run scrapes and upserts to Postgres and publishes
nothing; the page's data is served live. `src/main.ts` and `runPipeline` today still write
`venue-events.ics`, `port-calls.ics` and the site payload to disk — v1 code the build removes, leaving
the run a writer to the store alone.

## Consequences

- **The nightly workflow now holds the Postgres connection string as a secret.** A cost already spent
  by ADR-0025 (*there is now a server*, ADR-0010's zero-credentials property gone) — this ADR adds a
  secret of the same kind to the same workflow, not a change of kind. `tests/workflow.test.ts`'s
  zero-secret scan must be reconciled with this deliberately, not left to fail.
- **`src/main.ts` gains a source-selection argument and conditional browser launch**, and loses its
  file writes. The registry array and the `Source` contract are unchanged; the change is in the entry
  point and the workflow, not the ingestion seam.
- **`daily.yml` gains a `workflow_dispatch` input** for the source id and keeps its existing
  `workflow_dispatch` and `concurrency` block. `tests/workflow.test.ts`'s structural guards over the
  cron/offset/threshold relationship (ADR-0013) survive; the freshness watcher's fetch target changes
  from a Pages URL to the served-payload URL.
- **`/to-spec` reads this as: the scheduling seam is settled.** One nightly full run plus an on-demand
  single-source input, queued; a browser launched on declared need; breakage as issues; a re-pointed
  freshness watcher; no static output. Per-source cadence, an admin health panel, run history and an
  admin-page trigger button are each deferred with a named reopen trigger and are not part of the plan.

## Accepted limitations

- **The on-demand trigger is an Actions-UI dispatch, not an admin-page button** (§3). One operator, one
  dropdown; the friction is real but small, and the button is a clean later addition.
- **No run history exists beyond an issue's open/closed state** (§7). The track record a noisy source
  would justify is not captured until the reopen trigger fires.
- **Per-source cadence is unbuilt** (§1). A source whose data moves faster than daily is served stale
  between nightly runs until the reopen trigger forces the scheduler.

## Alternatives rejected

- **Move the scrape onto the server** (§2) — a cleaner long-term story with the on-demand trigger where
  the operator already is, rejected on the cost of a browser and a batch workload on the serving host,
  and on ADR-0025 §2 having chosen Postgres to keep the scrape in Actions.
- **A real per-source scheduler** (§1) — machinery for cadences no source on the list demonstrates.
  Rejected as decided-correctness; reopens on a fast-churning source.
- **Allow overlapping runs** (§4) — faster by-hand runs at the cost of false breakage signals from
  concurrent writers reading each other's partial state. Rejected; queuing is nearly free at one
  operator.
- **A per-source status table and admin health panel now** (§7) — richer, all-in-one-place, and a real
  build against a want the MVP does not yet feel. Rejected; the issue-per-source already satisfies
  "visible without reading logs."
