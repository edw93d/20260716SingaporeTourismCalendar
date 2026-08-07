import { describe, expect, it, vi } from "vitest";
import { instant } from "../src/domain/instant.js";
import { main, type MainDeps } from "../src/main.js";
import type { BrowserSession } from "../src/sources/types.js";
import type { PipelineOptions, PipelineRun } from "../src/pipeline/run.js";

/**
 * **The entry point's wiring — the conditional browser launch (ADR-0028 §6).**
 * `selectRun` decides *whether* a browser is needed (tested pure in
 * `select.test.ts`); this holds that `main` acts on that decision: it launches
 * Chromium only when the selected run needs one, passes the session through to
 * the pipeline, and closes it in a `finally` even when the run throws. Every
 * collaborator is a fake injected through `MainDeps`, so the wiring runs with no
 * real browser, network, store or `gh` — the reason `main` takes injected deps.
 *
 * The selection is driven the real way, through `source` (the `SOURCE` input):
 * an empty input is the whole registry — which includes MBCCS and so needs a
 * browser — and a source id is that one, browser or not. So these also confirm
 * `main` reads the registry `selectRun` reads, not a stubbed one.
 */

const emptyRun: PipelineRun = {
  ranAt: instant("2026-07-01T02:00:00Z"),
  outcomes: [],
  breakage: [],
};

/**
 * Fakes for every dependency, with the browser launch and close observable and
 * the pipeline run captured so a test can read the options it was handed. `over`
 * replaces any default — `source` to steer the selection, `run` to make it throw.
 */
const harness = (over: Partial<MainDeps> = {}) => {
  const close = vi.fn(async () => {});
  // The session is opaque here: `main` only forwards it to the pipeline, so a
  // sentinel that `run` can be asserted to have received is all this needs.
  const session = { sentinel: "browser-session" } as unknown as BrowserSession;
  const launchBrowser = vi.fn(async () => ({ session, close }));
  const run = vi.fn(async (_options: PipelineOptions) => emptyRun);
  const alert = vi.fn(async () => {});

  const deps: MainDeps = {
    source: undefined,
    connectionString: () => "postgres://fake/db",
    now: () => new Date("2026-07-01T02:00:00Z"),
    launchBrowser,
    createHttp: () => ({
      get: async () => {
        throw new Error("the wiring test must not make requests");
      },
    }),
    run,
    alert,
    ...over,
  };

  const optionsPassedToRun = (): PipelineOptions => {
    expect(run).toHaveBeenCalledOnce();
    return run.mock.calls[0]![0];
  };

  return { deps, launchBrowser, close, run, session, optionsPassedToRun };
};

describe("main — the browser launch is conditional on the selection", () => {
  it("launches a browser for a full run and hands the session to the pipeline", async () => {
    // Empty `source` is the whole registry, which includes MBCCS, so a browser is
    // launched exactly once and forwarded to the run — and released after it.
    const { deps, launchBrowser, close, session, optionsPassedToRun } = harness({ source: undefined });

    await main(deps);

    expect(launchBrowser).toHaveBeenCalledOnce();
    expect(optionsPassedToRun().browser).toBe(session);
    expect(optionsPassedToRun().full).toBe(true);
    expect(close).toHaveBeenCalledOnce();
  });

  it("launches a browser for a single source that declares it needs one", async () => {
    // MBCCS by hand: a browser-declaring source, run alone, still boots Chromium.
    const { deps, launchBrowser, close, session, optionsPassedToRun } = harness({ source: "mbccs" });

    await main(deps);

    expect(launchBrowser).toHaveBeenCalledOnce();
    expect(optionsPassedToRun().browser).toBe(session);
    expect(optionsPassedToRun().full).toBe(false);
    expect(close).toHaveBeenCalledOnce();
  });

  it("launches no browser for a browser-less single source, and closes nothing", async () => {
    // The common troubleshooting case (ADR-0028 §6): a by-hand run of a
    // server-rendered source boots no browser at all, and the pipeline is handed
    // no session — `browser` must be absent from the options, not present-and-
    // undefined, since MBCCS's `fetch` throws loudly on a missing-but-expected one.
    const { deps, launchBrowser, close, optionsPassedToRun } = harness({ source: "suntec" });

    await main(deps);

    expect(launchBrowser).not.toHaveBeenCalled();
    expect(optionsPassedToRun()).not.toHaveProperty("browser");
    expect(optionsPassedToRun().full).toBe(false);
    expect(close).not.toHaveBeenCalled();
  });

  it("closes the browser even when the run throws", async () => {
    // The `finally` is the whole reason the launch and close live at the entry
    // point: a source that throws mid-scrape must still release Chromium, so the
    // browser never outlives the process's work.
    const failing = vi.fn(async (_options: PipelineOptions): Promise<PipelineRun> => {
      throw new Error("store unreachable");
    });
    const { deps, close } = harness({ source: "mbccs", run: failing });

    await expect(main(deps)).rejects.toThrow("store unreachable");
    expect(close).toHaveBeenCalledOnce();
  });
});
