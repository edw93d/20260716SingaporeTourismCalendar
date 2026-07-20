import { describe, expect, it } from "vitest";
import { createHttpClient, type Fetch, type SleepReason } from "../src/pipeline/http.js";

/**
 * The client is the only route an adapter has to the network, which is what
 * makes politeness structural rather than disciplinary. These tests assert the
 * policy an adapter therefore cannot opt out of.
 */

const ok = (body: string) =>
  new Response(body, { status: 200, headers: { "content-type": "text/html" } });

/**
 * A client whose sleeps are recorded rather than served, so tests take no time.
 *
 * Waits are recorded *with their reason*. The three the client owes — to the
 * host, to a struggling host, and to the run — are otherwise indistinguishable
 * once they are only milliseconds, and a test that conflated them would assert
 * the politeness of a timeout.
 */
const clientRecording = (fetchImpl: Fetch) => {
  const slept: { ms: number; reason: SleepReason }[] = [];
  const client = createHttpClient({
    fetch: fetchImpl,
    sleep: async (ms, reason) => {
      slept.push({ ms, reason });
    },
  });
  const waitsFor = (reason: SleepReason) =>
    slept.filter((s) => s.reason === reason).map((s) => s.ms);
  return { client, slept, waitsFor };
};

const URL_A = "https://www.suntecsingapore.com/visit-events";
const URL_B = "https://www.suntecsingapore.com/other";
const OTHER_HOST = "https://www.singaporecruise.com.sg/schedule";

describe("the rate-limited client", () => {
  it("returns the body of a successful GET", async () => {
    const { client } = clientRecording(async () => ok("<html>hi</html>"));
    expect(await client.get(URL_A)).toBe("<html>hi</html>");
  });

  it("identifies itself honestly, with a route to the operator", async () => {
    const headers: Headers[] = [];
    const { client } = clientRecording(async (_url, init) => {
      headers.push(new Headers(init?.headers));
      return ok("");
    });

    await client.get(URL_A);

    const agent = headers[0]?.get("user-agent") ?? "";
    // A well-behaved reader says who it is. The facts-only legal position rests
    // on that posture, so the UA is not a place to impersonate a browser.
    expect(agent).toMatch(/sg-tourism-calendar/i);
    expect(agent).toMatch(/https?:\/\//);
  });

  it("waits between two requests to the same host", async () => {
    const { client, waitsFor } = clientRecording(async () => ok(""));

    await client.get(URL_A);
    await client.get(URL_B);

    const waits = waitsFor("rate-limit");
    expect(waits).toHaveLength(1);
    // Not exactly the interval: what is owed is the remainder of it, and the
    // first request already consumed a millisecond or two of that.
    expect(waits[0]).toBeGreaterThan(900);
    expect(waits[0]).toBeLessThanOrEqual(1000);
  });

  it("does not make one host's rate limit another host's problem", async () => {
    // Sources are read sequentially; a shared limiter would make each source pay
    // for the politeness owed to the previous one's host.
    const { client, waitsFor } = clientRecording(async () => ok(""));

    await client.get(URL_A);
    await client.get(OTHER_HOST);

    expect(waitsFor("rate-limit")).toEqual([]);
  });

  it("retries a 503 and returns the body once it succeeds", async () => {
    let calls = 0;
    const { client } = clientRecording(async () => {
      calls += 1;
      return calls < 3 ? new Response("busy", { status: 503 }) : ok("<html>late</html>");
    });

    expect(await client.get(URL_A)).toBe("<html>late</html>");
    expect(calls).toBe(3);
  });

  it("backs off further on each retry", async () => {
    const { client, waitsFor } = clientRecording(async () =>
      new Response("busy", { status: 503 }),
    );

    await expect(client.get(URL_A)).rejects.toThrow();

    const backoffs = waitsFor("backoff");
    expect(backoffs.length).toBeGreaterThan(1);
    expect(backoffs).toEqual([...backoffs].sort((a, b) => a - b));
    expect(new Set(backoffs).size).toBe(backoffs.length);
  });

  it("gives up after a bounded number of attempts, naming the status", async () => {
    let calls = 0;
    const { client } = clientRecording(async () => {
      calls += 1;
      return new Response("busy", { status: 503 });
    });

    await expect(client.get(URL_A)).rejects.toThrow(/503/);
    expect(calls).toBeLessThanOrEqual(4);
  });

  it("does not retry a 404 — a missing page will not appear by asking again", async () => {
    let calls = 0;
    const { client } = clientRecording(async () => {
      calls += 1;
      return new Response("gone", { status: 404 });
    });

    await expect(client.get(URL_A)).rejects.toThrow(/404/);
    expect(calls).toBe(1);
  });

  it("retries a transport error and then surfaces it", async () => {
    let calls = 0;
    const { client } = clientRecording(async () => {
      calls += 1;
      throw new Error("connect ETIMEDOUT");
    });

    await expect(client.get(URL_A)).rejects.toThrow(/ETIMEDOUT/);
    expect(calls).toBeGreaterThan(1);
  });

  it("abandons a request that never answers, rather than stalling the run", async () => {
    const { client } = clientRecording(async (_url, init) => {
      const signal = init?.signal;
      expect(signal).toBeInstanceOf(AbortSignal);
      // A real hang: resolve only when the timeout fires.
      return new Promise<Response>((_resolve, reject) => {
        signal?.addEventListener("abort", () => reject(new Error("aborted")));
      });
    });

    // The client owns the timeout, so a wedged source cannot hold the run open.
    await expect(client.get(URL_A)).rejects.toThrow();
  }, 60_000);
});
