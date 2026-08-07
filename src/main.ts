import { pathToFileURL } from "node:url";
import { createGhGateway } from "./alerts/gh.js";
import { reconcile } from "./alerts/issues.js";
import { createBrowserSession, type LaunchedBrowser } from "./pipeline/browser.js";
import { createHttpClient } from "./pipeline/http.js";
import { runPipeline, type PipelineOptions, type PipelineRun } from "./pipeline/run.js";
import { selectRun } from "./pipeline/select.js";
import { manifests, sources } from "./sources/registry.js";
import type { HttpClient } from "./sources/types.js";

/**
 * The daily run — the only production caller of `runPipeline`, and the only
 * place in this repository that constructs a network client, launches a browser
 * session, or reads a credential from the environment.
 *
 * `createHttpClient()` and `createBrowserSession()` are passed explicitly because
 * reaching the live internet — over HTTP (ADR-0010) or a headless browser
 * (ADR-0005, Amendment 2) — is something a caller says out loud. The Postgres
 * connection string is read here for the same reason (ADR-0025): v1 had zero
 * credentials, v2 holds exactly one, and this file is where it is named — once,
 * out loud, never defaulted. The store is injected exactly as the HTTP client is.
 *
 * Those real implementations are named once, in `productionDeps` below, and
 * reached only through the injected `MainDeps` — the same seam `serve.ts` uses to
 * hand `createCalendarServer` a store. It is what makes the wiring here — above
 * all the conditional browser launch — exercisable in `tests/main.test.ts`
 * without a real Chromium, network, store or `gh`, while keeping every real
 * construction site inside this one file (the architecture test holds that).
 *
 * **The run reads all sources, or one named on demand** (ADR-0028 §3). `SOURCE`
 * is the workflow's *"which source?"* input, forwarded as an environment variable
 * because a workflow speaks to a process through the environment; empty runs the
 * whole registry (the nightly cadence), a source id runs exactly that one.
 * `selectRun` turns that one input into the subset, whether a browser is needed,
 * and whether the freshness marker advances.
 *
 * **The browser's lifecycle is owned here** (ADR-0028 §6): launched before the run
 * and closed in a `finally`, so a source that throws mid-scrape still releases
 * Chromium. Only the *launch* is now conditional — Chromium boots only when a
 * source in the selected run declares `needsBrowser`, so a by-hand run of a
 * browser-less source boots none. Even when launched, only MBCCS can reach it, by
 * the shape of `FetchDeps`.
 */

/**
 * Everything the daily run reaches the outside world through. Injected so the
 * wiring above — the conditional launch, the pass-through to the pipeline, the
 * close-in-`finally` — is testable without any real I/O. Production supplies
 * `productionDeps`; a test supplies fakes. Construction stays lazy (`launchBrowser`,
 * `createHttp`, `connectionString` are thunks) so a browser-less run builds no
 * browser and an absent connection string still throws inside the run, after any
 * launch, exactly as it did when these were called inline.
 */
export type MainDeps = {
  /** The workflow's *"which source?"* input; empty/undefined runs the whole registry. */
  source: string | undefined;
  /** The store connection, required (never defaulted) at the entry point. */
  connectionString: () => string;
  /** The run clock, passed through to the pipeline. */
  now: () => Date;
  /** Launches Chromium. Called only when a selected source declares `needsBrowser`. */
  launchBrowser: () => Promise<LaunchedBrowser>;
  /** Constructs the rate-limited HTTP client. */
  createHttp: () => HttpClient;
  /** The pipeline run itself. */
  run: (options: PipelineOptions) => Promise<PipelineRun>;
  /**
   * Raises or clears the operator's breakage issues (ADR-0007, #41). A failure
   * here is logged and swallowed, not fatal — the run's writes have already
   * landed by the time it is called.
   */
  alert: (breakage: PipelineRun["breakage"]) => Promise<void>;
};

/**
 * The one credential read in `src/` — the single injection site the architecture
 * test allows (ADR-0025 spends ADR-0010's zero-credentials property, keeping its
 * code shape: injected, never defaulted). Absent, the run refuses rather than
 * improvising a connection.
 */
const requireConnectionString = (): string => {
  const value = process.env["DATABASE_URL"];
  if (!value) {
    throw new Error("DATABASE_URL is required — the store connection is injected, never defaulted.");
  }
  return value;
};

/**
 * The real implementations, named once. `SOURCE` and the connection string are
 * the only environment reads in `src/` outside `serve.ts`; the browser and HTTP
 * client are constructed here and nowhere else — the two properties the
 * architecture test holds against this file.
 */
const productionDeps: MainDeps = {
  source: process.env["SOURCE"],
  connectionString: requireConnectionString,
  now: () => new Date(),
  launchBrowser: () => createBrowserSession(),
  createHttp: () => createHttpClient(),
  run: runPipeline,
  alert: (breakage) => reconcile(breakage, createGhGateway()),
};

export const main = async (deps: MainDeps = productionDeps): Promise<void> => {
  const selection = selectRun(sources, manifests, deps.source);

  // Launch Chromium **only** when a source in this run needs it (ADR-0028 §6). A
  // full run includes MBCCS and launches once, as before; a by-hand run of a
  // browser-less source launches nothing and needs no Chromium installed at all.
  const browser = selection.needsBrowser ? await deps.launchBrowser() : undefined;

  try {
    const run = await deps.run({
      sources: selection.sources,
      full: selection.full,
      connectionString: deps.connectionString(),
      now: deps.now,
      http: deps.createHttp(),
      ...(browser ? { browser: browser.session } : {}),
    });

    console.log(`Ran at ${run.ranAt}`);

    for (const outcome of run.outcomes) {
      if (!outcome.ok) {
        console.log(`  ${outcome.source}: could not be read — ${outcome.reason}`);
        continue;
      }

      const broken = outcome.failures.length;
      console.log(
        `  ${outcome.source}: ${outcome.records} record(s)` +
          (broken === 0 ? "" : `, ${broken} row(s) failed to parse`),
      );
      for (const failure of outcome.failures) {
        console.log(`    ! expected ${failure.expected} in: ${failure.fragment.slice(0, 120)}`);
      }
    }

    // Raise or clear the operator's breakage issues (ADR-0007, #41). This runs
    // **after** the run has upserted, so an alerting failure — a `gh` hiccup, a
    // token that expired mid-run — is logged and swallowed rather than allowed to
    // fail a run whose writes already landed. The gateway authenticates with
    // `GITHUB_TOKEN` only, read by `gh` from the environment the workflow injects.
    try {
      await deps.alert(run.breakage);
    } catch (error) {
      console.error("Alert reconciliation failed:", error);
    }
  } finally {
    // The core owns the browser's lifecycle: when one was launched it is released
    // whether the run completed or a source threw, so Chromium never outlives the
    // process's work. A browser-less run launched nothing, so there is nothing to
    // close.
    await browser?.close();
  }
};

/**
 * **A source that could not be read is not a failed run.** Three of the four
 * breakage signals are already carried in the outcomes above, and turning one
 * into a non-zero exit would abort the whole run — punishing every healthy
 * source for one broken one, and losing a day of seen-tracking to a transient
 * 503. Surfacing that suspicion to the operator is #41's job, not this file's.
 *
 * A throw is different: it means the run itself failed — no connection, or a
 * store that could not be reached — and genuinely did not complete.
 *
 * Run only when this file is the process entry point, not when `tests/main.test.ts`
 * imports `main` to exercise its wiring. `serve.ts` self-invokes unconditionally
 * because nothing imports it; `main` is imported, so its run is guarded.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
