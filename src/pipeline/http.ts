import type { HttpClient } from "../sources/types.js";

/**
 * The one route an adapter has to the network.
 *
 * The core owns the policy — user agent, per-host rate limit, timeout, retry —
 * so that **politeness is structural, not disciplinary** (ADR-0005). An adapter
 * cannot construct a client, cannot reach `fetch`, and therefore cannot opt out
 * of any of this; the well-behaved-reader posture that the facts-only legal
 * position rests on cannot quietly lapse when a source is added in a hurry.
 */

/** The shape of `globalThis.fetch` this module needs. Injected, so it is testable. */
export type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

/**
 * Why the client is waiting. The three are wildly different obligations —
 * owed to the host, owed to a struggling host, and owed to the run — and a
 * caller that could only see the milliseconds could not tell them apart.
 */
export type SleepReason = "rate-limit" | "backoff" | "timeout";

export type HttpClientOptions = {
  fetch?: Fetch;
  /** Injected so tests exercise the waiting policy without serving the waits. */
  sleep?: (ms: number, reason: SleepReason) => Promise<void>;
};

/**
 * Says who we are and how to reach the operator.
 *
 * Deliberately **not** a browser string. Impersonating Chrome is what a reader
 * does when it expects to be unwelcome, and it is the first thing that would be
 * held against a scrape whose defence is that it takes only facts and behaves
 * itself. Suntec's `robots.txt` allows this page to every agent, so there is
 * nothing to hide from.
 */
const USER_AGENT =
  "sg-tourism-calendar/0.1 (+https://github.com/edw93d/20260716SingaporeTourismCalendar)";

/** One request per host per second. Every source needs one or two requests a day. */
const MIN_INTERVAL_MS = 1_000;

const TIMEOUT_MS = 30_000;

/** Three in total, so a flaky moment is survived and a broken host is not hammered. */
const MAX_ATTEMPTS = 3;
const BACKOFF_MS = [1_000, 2_000];

/**
 * Retried statuses are the ones that mean *not now*. A 404 or a 403 means *not
 * ever*, and asking again is both useless and impolite — a 403 in particular is
 * the shape SCC's Imperva would take if it stopped being passive, and retrying
 * into a WAF is exactly the behaviour that gets a reader blocked for good.
 */
const RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);

const defaultSleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    const timer = setTimeout(resolve, ms);
    // A pending politeness timer must not be the reason the process stays alive.
    if (typeof timer === "object" && "unref" in timer) timer.unref();
  });

class HttpError extends Error {
  constructor(readonly status: number, url: string) {
    super(`GET ${url} returned HTTP ${status}`);
  }
}

export const createHttpClient = ({
  fetch: fetchImpl = globalThis.fetch,
  sleep = defaultSleep,
}: HttpClientOptions = {}): HttpClient => {
  /** Last request per host. Per-host, so one source never pays another's debt. */
  const lastRequestAt = new Map<string, number>();

  const waitForTurn = async (host: string): Promise<void> => {
    const previous = lastRequestAt.get(host);
    const wait = previous === undefined ? 0 : previous + MIN_INTERVAL_MS - Date.now();
    if (wait > 0) await sleep(wait, "rate-limit");
  };

  const fetchOnce = async (url: string): Promise<Response> => {
    const controller = new AbortController();

    // The timeout is raced rather than delegated to `AbortSignal.timeout`, so it
    // runs on the same injected clock as everything else here — a client whose
    // waiting policy is only observable in real seconds is a client nobody tests.
    return Promise.race([
      fetchImpl(url, {
        headers: { "user-agent": USER_AGENT, accept: "text/html,application/xhtml+xml" },
        redirect: "follow",
        signal: controller.signal,
      }),
      sleep(TIMEOUT_MS, "timeout").then<never>(() => {
        controller.abort();
        throw new Error(`GET ${url} timed out after ${TIMEOUT_MS}ms`);
      }),
    ]);
  };

  return {
    get: async (url: string): Promise<string> => {
      const { host } = new URL(url);

      // Gated once per request, not once per attempt: the backoff below is
      // already at least the rate-limit interval, so charging both would only
      // make a struggling host wait longer to be left alone.
      await waitForTurn(host);

      let lastError: unknown;
      for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
        if (attempt > 0) await sleep(BACKOFF_MS[attempt - 1] ?? BACKOFF_MS.at(-1)!, "backoff");

        try {
          const response = await fetchOnce(url);

          if (response.ok) return await response.text();

          lastError = new HttpError(response.status, url);
          if (!RETRYABLE.has(response.status)) throw lastError;
        } catch (error) {
          if (error instanceof HttpError && !RETRYABLE.has(error.status)) throw error;
          lastError = error;
        } finally {
          // Stamped however the attempt ended. A request that failed still
          // reached the host, so it still owes the next one a full interval —
          // charging only successes would let a failing host be retried fastest.
          lastRequestAt.set(host, Date.now());
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new Error(`GET ${url} failed: ${String(lastError)}`);
    },
  };
};
