# ADR-0012: The merge check is advisory, not required

- **Status:** Accepted
- **Date:** 2026-07-23
- **Ticket:** [#60](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/60)

## Context

`main` has two writers with genuinely different natures.

A human opens a pull request that changes **code**. #45 added `ci.yml` and made its `check`
job a required status check on `main`, so a red suite blocks the merge. That is exactly the
right gate for that writer: every guard this repo relies on — the banned bare "event" term,
the zero-`process.env` rule, ADR-0010's single client construction site, the structural
properties `tests/workflow.test.ts` holds — is enforced by a test, and a test enforces nothing
on a change nobody ran it against.

The daily pipeline writes **generated data and no code**: `data/calendar.sqlite`,
`site/feeds`, `site/calendar.json`. It pushes directly to `main` (`daily.yml`, the *Commit the
refreshed store and feeds* step), authenticating with the run-scoped `GITHUB_TOKEN`.

Requiring `check` broke the second writer. A direct push carries no status, so branch
protection declined it:

```
remote: error: GH006: Protected branch update failed for refs/heads/main.
remote: - Required status check "check" is expected.
```

The pipeline failed from 2026-07-21 until this decision. The scrape kept succeeding and the
site stayed up; only the publish step failed, so readers saw a **stale** calendar that
rendered perfectly (`CONTEXT.md` § Freshness). This is the failure the project exists to
prevent — correct on the day it was compiled, silently wrong afterwards — reproduced inside
the pipeline meant to prevent it.

The rebase-and-retry fallback at the push site could not help: the rejection is a missing
required status, not a stale ref, so the retry re-pushes an equally check-less commit.

## Decision

**Remove `check` from `main`'s required status checks. `ci.yml` still runs on every pull
request and on every push to `main`; its result is advisory.**

The merge check is a **code** gate. The daily commit carries no code — a SQLite blob and
regenerated feeds — so running the suite against it grades the previous run's code a second
time and gates today's freshness on the answer. The gate should not apply to that writer, and
this is the only way available to this repository to stop it applying.

The rest of `main`'s protection is unchanged: force-pushes and deletions remain blocked.

## Consequences

- **Publishing works again**, with no stored credential. The daily job still pushes with the
  run-scoped `GITHUB_TOKEN`, and `tests/workflow.test.ts`'s zero-credentials guarantee is
  untouched. This decision costs nothing operationally — it is paid for entirely in the
  weakened gate below.
- **A red pull request is now mergeable.** `ci.yml` reports, and a failing merge still shows
  a red X on `main`, but nothing stops the merge. #45's signal survives; #45's *block* does
  not. On a repository with one human merging, this is a habit where there used to be a
  structure — and this repo's stated preference is structural over operational, so this is a
  real regression, accepted because the alternatives are worse.
- **Nothing in this repository enforces or reveals the decision.** Branch protection is
  out-of-band state, like Pages-enabled (ADR-0011), and no test can hold it — a test that
  greps this file or `daily.yml` would enforce a comment, not a behaviour. It is written down
  here for the same reason ADR-0011 wrote down Pages-enabled: it is state a reader of the
  working tree cannot see.
- **The upgrade path is a repository transfer.** See the first rejected alternative. If this
  repo ever moves to an organization, revisit this ADR — the good option becomes available.
- **A publish failure is still invisible.** Removing the required check fixes *this* cause;
  it does nothing about the three days of silence. Breakage detection (#41, ADR-0007) watches
  **Source health** and runs in the step *before* the one that failed, so it cannot observe
  this class of failure even in principle. [#61](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/61)
  covers the freshness alarm and is the only thing that would notice if this decision were
  ever quietly reverted.

## Alternatives rejected

- **A ruleset with the GitHub Actions app as a bypass actor.** The decision we wanted:
  humans still blocked by a red suite, the automated writer exempt, no stored credential.
  **The platform refuses it on this repository.** Classic branch protection has no
  bypass-actor list at all — bypass actors exist only on rulesets — and creating the ruleset
  returns `422: "Actor GitHub Actions integration must be part of the ruleset source or owner
  organization"`. This repository is owned by a **user**, not an organization, so there is no
  owning org for the app to belong to. Recorded in detail because the option is correct and
  becomes available the moment the repo is org-owned.
- **The daily job opens a pull request and auto-merges it**, so `check` runs and is satisfied
  honestly. **Deadlocks.** GitHub does not trigger workflow runs from events created by
  `GITHUB_TOKEN`, so the pipeline's own PR would never start `ci.yml`, `check` would never
  report, and auto-merge would wait forever. Making it work needs a PAT or App key — a stored
  credential, which `tests/workflow.test.ts` forbids by test and which #46 already showed to
  be the wall administrative actions hit.
- **Scope the required check to human pull requests only.** Not a setting. Classic protection
  applies required status checks to every push, with no scoping by actor or by path; the idea
  collapses into this decision.
- **Move the store and feeds to an unprotected branch**, leaving `main` fully gated. Reverses
  ADR-0011 four days after it was taken: the feeds are committed on `main` precisely so the
  `.ics` diff stays legible next to an opaque blob, and a publish branch is the "diffable, but
  on a branch nobody reads" outcome that ADR rejected. Buys a stronger gate with the
  diffability the previous decision was written to secure.
