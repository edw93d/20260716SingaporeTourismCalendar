import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { instant } from "../src/domain/instant.js";
import { openStore, type Store } from "../src/store/store.js";
import { freshSchema, type EphemeralStore } from "./support/postgres.js";

/**
 * The store's **run-marker** — the one instant the freshness alarm reads
 * (ADR-0013, #154). v1 baked `generatedAt` into a committed `calendar.json`; v2's
 * pipeline is a pure writer and the server builds the payload live, so the run
 * instant has to live *in the store*: written once per run, read back on every
 * request. It must advance whenever a run completes — even one that confirmed no
 * source at all — because Freshness is a property of the publish, orthogonal to
 * Source health in both directions (CONTEXT.md § Freshness, `src/site/payload.ts`).
 *
 * Exercised against a real ephemeral Postgres schema, like every other store
 * behaviour (ADR-0025) — a fake is exactly where a single-row upsert's trap hides.
 */

let schema: EphemeralStore;

beforeEach(async () => {
  schema = await freshSchema();
});

afterEach(async () => {
  await schema.drop();
});

const withStore = async (work: (store: Store) => Promise<void>): Promise<void> => {
  const store = await openStore(schema.connectionString);
  try {
    await work(store);
  } finally {
    await store.close();
  }
};

describe("the run-marker (#154, ADR-0013)", () => {
  it("has no last run before any run is recorded", async () => {
    // A fresh store has never published: the server serves this as "no
    // generatedAt", which the freshness alarm reads as not-yet-published rather
    // than as a stale but real calendar.
    await withStore(async (store) => {
      expect(await store.lastRun()).toBeNull();
    });
  });

  it("returns the instant the run recorded", async () => {
    await withStore(async (store) => {
      await store.recordRun(instant("2026-08-06T19:37:00Z"));
      expect(await store.lastRun()).toBe("2026-08-06T19:37:00Z");
    });
  });

  it("advances to the newest run, keeping exactly one marker", async () => {
    // Recorded every run: `lastRun` is the *latest* one, not a log. A second
    // record overwrites rather than appends — the alarm reads one instant.
    await withStore(async (store) => {
      await store.recordRun(instant("2026-08-06T19:37:00Z"));
      await store.recordRun(instant("2026-08-07T19:37:00Z"));
      expect(await store.lastRun()).toBe("2026-08-07T19:37:00Z");
    });
  });

  it("re-validates the stored instant on the way out", async () => {
    // A store a human can reach and a bad migration can mangle must not let a
    // malformed instant reach the freshness alarm as a plausible recent date —
    // the same parse-not-cast rule every other read here follows.
    await withStore(async (store) => {
      await store.recordRun(instant("2026-08-06T19:37:00Z"));
      const value = await store.lastRun();
      expect(value).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
    });
  });

  it("persists across store handles — a later request reads an earlier run", async () => {
    // The whole point: the pipeline records the run through one connection and
    // the server reads it back through another, minutes or hours later.
    await withStore(async (store) => {
      await store.recordRun(instant("2026-08-06T19:37:00Z"));
    });
    await withStore(async (store) => {
      expect(await store.lastRun()).toBe("2026-08-06T19:37:00Z");
    });
  });
});
