import { chromium, type Browser } from "playwright";
import type { BrowserSession } from "../sources/types.js";

/**
 * The one place a headless browser is constructed — the counterpart to
 * `createHttpClient` for the network (ADR-0005, Amendment 2). It launches
 * Chromium, adapts a page to the minimal `BrowserSession` the adapters see, and
 * hands back a `close` so the **core owns the lifecycle**: the entry point
 * launches once and closes in a `finally`, and no adapter ever touches Playwright
 * or a raw page. A guard in `tests/architecture.test.ts` holds that this module is
 * the sole importer of `playwright` and `main.ts` its sole caller.
 *
 * `evaluate` / `waitForFunction` take **string** expressions rather than functions
 * on purpose: the adapter's page scripts (the React fiber walk) are defined as
 * source-knowledge string constants in `mbccs.ts`, and forwarding them as strings
 * keeps them out of this module, which knows nothing about any source.
 */
export type LaunchedBrowser = {
  session: BrowserSession;
  close: () => Promise<void>;
};

export const createBrowserSession = async (): Promise<LaunchedBrowser> => {
  const browser: Browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  const session: BrowserSession = {
    goto: async (url) => {
      // `domcontentloaded`, not `load`: the schedule is hydrated by client JS and
      // fetched over the network, so `load` firing means nothing about the data.
      // The adapter blocks on its own settle condition (`waitForFunction`) instead.
      await page.goto(url, { waitUntil: "domcontentloaded" });
    },
    evaluate: <T>(expression: string): Promise<T> =>
      page.evaluate(expression) as Promise<T>,
    click: async (selector) => {
      await page.click(selector);
    },
    // Poll via `page.evaluate`, not `page.waitForFunction`. The schedule site's CSP
    // forbids `unsafe-eval`, and `waitForFunction(string)` injects the condition as
    // `new Function(str)` → `EvalError: 'unsafe-eval' is not an allowed source of
    // script`. `evaluate(string)` runs over CDP `Runtime.evaluate` and is CSP-exempt,
    // so a manual poll loop over it is the only way to block on a page condition here.
    waitForFunction: async (expression) => {
      const deadline = Date.now() + 30_000;
      while (Date.now() < deadline) {
        if (await page.evaluate(expression)) return;
        await page.waitForTimeout(100);
      }
      throw new Error(`waitForFunction timed out after 30s: ${expression}`);
    },
  };

  return {
    session,
    close: async () => {
      await browser.close();
    },
  };
};
