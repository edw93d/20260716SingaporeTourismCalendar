import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { instant } from "../src/domain/instant.js";
import type { Scraped, VenueEvent } from "../src/domain/types.js";
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

/**
 * The **moderation-flag write** (#156, ADR-0024, ADR-0030) — the one write that
 * touches a `hidden`/`reviewed` column. Exercised against real SQL because its
 * whole job is the trap a fake would hide: it must set exactly the one flag it is
 * named, leave the other alone (independence, ADR-0024 §2), survive a re-scrape
 * (the upsert must not clear it, ADR-0024 §4), and be reversible byte-for-byte
 * (ADR-0024 §7).
 */
describe("the moderation-flag write (#156, ADR-0024)", () => {
  const scrapedVenueEvent = (over: Partial<Scraped<VenueEvent>> = {}): Scraped<VenueEvent> => ({
    source: "suntec",
    sourceKey: "bni-vision1472026",
    name: "BNI Vision",
    start: instant("2026-07-17T04:00:00Z"),
    end: instant("2026-07-17T10:00:00Z"),
    venue: "Suntec Convention Centre",
    hall: "Level 4, Hall 404",
    ...over,
  });

  /** Upserts one VenueEvent and returns its minted uid, so the flag write has a target. */
  const seedOne = async (store: Store): Promise<string> => {
    await store.upsertVenueEvent(scrapedVenueEvent(), instant("2026-07-01T02:00:00Z"));
    const [record] = await store.readVenueEvents();
    if (record === undefined) throw new Error("seed failed to insert a VenueEvent");
    return record.uid;
  };

  const only = async (store: Store): Promise<VenueEvent> => {
    const [record] = await store.readVenueEvents();
    if (record === undefined) throw new Error("expected exactly one VenueEvent");
    return record;
  };

  it("defaults both flags to not-set on a freshly scraped record", async () => {
    await withStore(async (store) => {
      await seedOne(store);
      const record = await only(store);
      expect(record.hidden).toBe(false);
      expect(record.reviewed).toBe(false);
    });
  });

  it("sets exactly the named flag, leaving the other untouched", async () => {
    // Independence (ADR-0024 §2): hiding does not imply reviewed.
    await withStore(async (store) => {
      const uid = await seedOne(store);

      expect(await store.setModerationFlag(uid, "hidden", true)).toBe(true);
      let record = await only(store);
      expect(record.hidden).toBe(true);
      expect(record.reviewed).toBe(false);

      expect(await store.setModerationFlag(uid, "reviewed", true)).toBe(true);
      record = await only(store);
      expect(record.hidden).toBe(true);
      expect(record.reviewed).toBe(true);
    });
  });

  it("is reversible — the opposite value restores the prior state, and only that flag", async () => {
    await withStore(async (store) => {
      const uid = await seedOne(store);
      await store.setModerationFlag(uid, "hidden", true);
      await store.setModerationFlag(uid, "reviewed", true);

      await store.setModerationFlag(uid, "hidden", false);

      const record = await only(store);
      expect(record.hidden).toBe(false);
      expect(record.reviewed).toBe(true); // reviewed rode through the unhide untouched
      expect(record.uid).toBe(uid); // same identity — nothing retired, nothing minted
    });
  });

  it("a later scrape does not clear a person's flag", async () => {
    // ADR-0024 §4: `hidden`/`reviewed` are excluded from `Scraped<T>` and the
    // upsert names neither, so re-observing the record cannot un-hide it.
    await withStore(async (store) => {
      const uid = await seedOne(store);
      await store.setModerationFlag(uid, "hidden", true);

      // The same record, observed again on a later run (a bumped seenAt).
      await store.upsertVenueEvent(scrapedVenueEvent(), instant("2026-07-02T02:00:00Z"));

      expect((await only(store)).hidden).toBe(true);
    });
  });

  it("reports an unknown uid as no match, so the route can 404 it", async () => {
    await withStore(async (store) => {
      await seedOne(store);
      expect(await store.setModerationFlag("no-such-uid@sg-tourism-calendar", "hidden", true)).toBe(
        false,
      );
    });
  });
});
