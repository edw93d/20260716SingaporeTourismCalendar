import { createBrowserSession } from "./pipeline/browser.js";
import { createHttpClient } from "./pipeline/http.js";
import { runPipeline } from "./pipeline/run.js";
import { DB_PATH, FEEDS_DIR, SITE_PAYLOAD } from "./paths.js";
import { sources } from "./sources/registry.js";

/**
 * The daily run — the only production caller of `runPipeline`, and the only
 * place in this repository that constructs a network client or a browser session.
 *
 * `createHttpClient()` and `createBrowserSession()` are passed explicitly because
 * reaching the live internet — over HTTP (ADR-0010) or a headless browser
 * (ADR-0005, Amendment 2) — is something a caller says out loud. This file is
 * where it gets said, once.
 *
 * The browser's lifecycle is owned here: launched before the run and closed in a
 * `finally`, so a source that throws mid-scrape still releases Chromium. MBCCS is
 * the only source that reads it; the others cannot, by the shape of `FetchDeps`.
 */

const main = async (): Promise<void> => {
  const browser = await createBrowserSession();

  try {
    const run = await runPipeline({
      sources,
      db: DB_PATH,
      feedsDir: FEEDS_DIR,
      payloadPath: SITE_PAYLOAD,
      now: () => new Date(),
      http: createHttpClient(),
      browser: browser.session,
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
  } finally {
    // The core owns the browser's lifecycle: it is released whether the run
    // completed or a source threw, so Chromium never outlives the process's work.
    await browser.close();
  }
};

/**
 * **A source that could not be read is not a failed run.** Three of the four
 * breakage signals are already carried in the outcomes above, and turning one
 * into a non-zero exit would abort the steps that commit the store and publish
 * the site — punishing every healthy source for one broken one, and losing a
 * day of seen-tracking to a transient 503. Surfacing that suspicion to the
 * operator is #41's job, not this file's.
 *
 * A throw is different: it means no feed was written, so there is nothing to
 * publish and the run genuinely failed.
 */
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
