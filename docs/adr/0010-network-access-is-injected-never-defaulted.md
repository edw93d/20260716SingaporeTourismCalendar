# ADR-0010: Network access is injected, never defaulted

- **Status:** Accepted
- **Date:** 2026-07-20
- **Ticket:** [#34](https://github.com/edw93d/20260716SingaporeTourismCalendar/issues/34)

## Context

ADR-0005 put the politeness policy — user agent, per-host rate limit, timeout, retry —
in the core, so an adapter cannot opt out of it. Until #34 there was no client to inject:
`PipelineOptions` carried a `NO_HTTP_CLIENT_YET` placeholder whose whole job was to make
unfinished wiring **refuse rather than improvise**.

#34 retired that placeholder, because a real adapter needs a real client. The first
implementation replaced it with a parameter default:

```ts
http = createHttpClient()
```

That reads as a convenience — no caller has to know the policy to run the pipeline — and
it inverts the property the placeholder existed to provide. A caller who simply *forgets*
to inject no longer fails; it silently reaches the live internet. The forgetful caller is
not hypothetical: at the time of writing, `runPipeline`'s only callers are tests, and one
of them was calling it with no client at all.

For a scrape whose legal position rests on being a well-behaved reader, "reached the live
site by accident" is the one failure that must not be quiet.

## Decision

**`http: HttpClient` is required on `PipelineOptions`.** There is no default.

Reaching the network is something a caller has to say out loud:

- **Tests** pass a stub. `tests/pipeline.test.ts` passes one that *throws* on any request,
  since every source in that file is a fake that serves its own bytes — so an accidental
  request fails loudly and names the URL it tried.
- **The entry point** (#35, the daily GitHub Actions run) passes `createHttpClient()`.

## Consequences

- The loud-failure property of `NO_HTTP_CLIENT_YET` survives the placeholder's removal,
  which was the point of the placeholder.
- **`createHttpClient` is tested but unreferenced by any production path until #35 lands.**
  This is expected, not dead code: there is no entry point yet, so there is nothing for it
  to be referenced *by*. It is noted here so a later reader does not mistake it for cruft
  and delete the policy this project's posture depends on.
- Every new caller pays one line and one decision. That is the intended cost — the decision
  is "may this code reach the internet," and it should not be inherited by omission.

## Alternatives rejected

- **Default to `createHttpClient()`** — the convenience is real and the failure mode is
  silent live traffic from code that never said it wanted any. Rejected above.
- **Default only at the CLI entry point** — the shape usually recommended, and unavailable
  here: there is no entry point yet (#35). Once #35 exists it passes the client explicitly,
  which is this decision, not an alternative to it.
- **Split `src/pipeline/http.ts` into its own ticket and slim it here** — the retry ladder,
  timeout race and `SleepReason` taxonomy are arguably unspecced surface for #34, which asks
  only that fetches go through the injected client. Rejected because retiring the placeholder
  was unavoidable once a real adapter existed, the client is covered by 10 tests, and
  splitting would discard working, tested code to satisfy a ticket boundary.
