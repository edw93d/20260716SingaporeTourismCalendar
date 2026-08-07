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

/**
 * The **bulk moderation-flag write** (#157, ADR-0024) — the same one flag on many
 * records at once, so a moderator can hide or mark a whole filtered selection in a
 * single action (filter-then-bulk). Exercised against real SQL for the same reason
 * the single write is: it must touch *only* the one named flag on *only* the named
 * rows, leave every other flag and every unlisted row exactly as they were
 * (independence, ADR-0024 §2), be reversible byte-for-byte (ADR-0024 §7), and
 * report how many of the named uids actually matched — so the route and the toast
 * count what really changed rather than what was asked for.
 */
describe("the bulk moderation-flag write (#157, ADR-0024)", () => {
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

  /** Seeds `count` distinct VenueEvents and returns their minted uids, in read order. */
  const seedMany = async (store: Store, count: number): Promise<string[]> => {
    for (let i = 0; i < count; i++) {
      await store.upsertVenueEvent(
        scrapedVenueEvent({ sourceKey: `event-${i}`, name: `Event ${i}` }),
        instant("2026-07-01T02:00:00Z"),
      );
    }
    return (await store.readVenueEvents()).map((record) => record.uid);
  };

  const byUid = async (store: Store): Promise<Map<string, VenueEvent>> =>
    new Map((await store.readVenueEvents()).map((record) => [record.uid, record]));

  it("sets the flag on exactly the named uids, leaving unlisted rows untouched", async () => {
    await withStore(async (store) => {
      const [a, b, c] = await seedMany(store, 3);

      const matched = await store.setModerationFlags([a!, c!], "hidden", true);

      expect(matched).toBe(2);
      const rows = await byUid(store);
      expect(rows.get(a!)?.hidden).toBe(true);
      expect(rows.get(c!)?.hidden).toBe(true);
      // The row that was not named keeps its default — the write named it nowhere.
      expect(rows.get(b!)?.hidden).toBe(false);
    });
  });

  it("names only the one flag, so a bulk hide never marks anything reviewed", async () => {
    // Independence (ADR-0024 §2) holds in bulk exactly as it does for one row.
    await withStore(async (store) => {
      const uids = await seedMany(store, 3);

      await store.setModerationFlags(uids, "hidden", true);

      const rows = await byUid(store);
      for (const uid of uids) {
        expect(rows.get(uid)?.hidden).toBe(true);
        expect(rows.get(uid)?.reviewed).toBe(false);
      }
    });
  });

  it("is reversible — the opposite value restores the whole set", async () => {
    await withStore(async (store) => {
      const uids = await seedMany(store, 3);
      await store.setModerationFlags(uids, "hidden", true);

      const reverted = await store.setModerationFlags(uids, "hidden", false);

      expect(reverted).toBe(3);
      const rows = await byUid(store);
      for (const uid of uids) expect(rows.get(uid)?.hidden).toBe(false);
    });
  });

  it("counts only the uids that matched, ignoring unknown ones", async () => {
    // A selection can name a uid the store never had; the count is what really
    // changed, so the toast and the route report the truth, not the request size.
    await withStore(async (store) => {
      const [a] = await seedMany(store, 1);

      const matched = await store.setModerationFlags(
        [a!, "ghost-1@sg-tourism-calendar", "ghost-2@sg-tourism-calendar"],
        "hidden",
        true,
      );

      expect(matched).toBe(1);
    });
  });

  it("an empty selection writes nothing and matches nothing", async () => {
    await withStore(async (store) => {
      const uids = await seedMany(store, 2);

      expect(await store.setModerationFlags([], "hidden", true)).toBe(0);

      const rows = await byUid(store);
      for (const uid of uids) expect(rows.get(uid)?.hidden).toBe(false);
    });
  });
});

/**
 * The **manual write path** (#158, ADR-0024 §9) — the second write into the store,
 * outside the `Source` contract. Exercised against real SQL because its whole job
 * is what a fake would paper over: a hand-entered row must land with the *set*
 * moderation flags the scrape's upsert deliberately never touches (`reviewed:
 * true`, `hidden: false`), a minted `uid`, and a `firstSeenAt`/`lastSeenAt` frozen
 * at the typed instant. It is the only write that names a moderation column on the
 * way *in*, so it is the one place a wrong literal would silently ship an event
 * that either hides itself or re-enters the review queue.
 */
describe("the manual write path (#158, ADR-0024 §9)", () => {
  const manualEntry = (over: Partial<Scraped<VenueEvent>> = {}): Scraped<VenueEvent> => ({
    source: "manual",
    sourceKey: "manual-key-1",
    name: "Ad-hoc industry mixer",
    start: instant("2026-09-01T10:00:00Z"),
    end: instant("2026-09-01T12:00:00Z"),
    venue: "Some rooftop bar",
    hall: null,
    ...over,
  });

  const only = async (store: Store): Promise<VenueEvent> => {
    const [record] = await store.readVenueEvents();
    if (record === undefined) throw new Error("expected exactly one VenueEvent");
    return record;
  };

  it("arrives Reviewed and Shown — a person typed it (CONTEXT.md § Reviewed)", async () => {
    // The one write that sets the flags on the way in: reviewed:true (looked-at by
    // definition) and hidden:false (shown). The scrape's upsert sets neither.
    await withStore(async (store) => {
      await store.addManualVenueEvent(manualEntry(), instant("2026-08-07T06:30:00Z"));
      const record = await only(store);
      expect(record.reviewed).toBe(true);
      expect(record.hidden).toBe(false);
    });
  });

  it("mints a uid and freezes firstSeenAt = lastSeenAt at the typed instant", async () => {
    // `manual` is never re-observed, so its lastSeenAt never advances — which is
    // exactly why it is exempt from Source health (ADR-0007).
    await withStore(async (store) => {
      const typedAt = instant("2026-08-07T06:30:00Z");
      const returned = await store.addManualVenueEvent(manualEntry(), typedAt);

      expect(returned.uid).toMatch(/@sg-tourism-calendar$/);
      expect(returned.source).toBe("manual");
      expect(returned.sourceKey).toBe("manual-key-1");
      expect(returned.firstSeenAt).toBe(typedAt);
      expect(returned.lastSeenAt).toBe(typedAt);

      // The returned record is the stored one — the RETURNING echo maps the same
      // row the whole-table read does.
      const stored = await only(store);
      expect(stored).toEqual(returned);
    });
  });

  it("stores exactly the typed content, hall and all", async () => {
    await withStore(async (store) => {
      const returned = await store.addManualVenueEvent(
        manualEntry({ name: "Trade preview", venue: "Hall A", hall: "Level 2" }),
        instant("2026-08-07T06:30:00Z"),
      );
      expect(returned.name).toBe("Trade preview");
      expect(returned.venue).toBe("Hall A");
      expect(returned.hall).toBe("Level 2");
      expect(returned.start).toBe("2026-09-01T10:00:00Z");
      expect(returned.end).toBe("2026-09-01T12:00:00Z");
    });
  });

  it("keeps two manual entries as two rows — duplicates are accepted, not merged", async () => {
    // ADR-0024 §1: every record stands alone under (source, sourceKey); a distinct
    // minted key each time means a re-entry is a new row, hidden by hand if wrong.
    await withStore(async (store) => {
      const a = await store.addManualVenueEvent(
        manualEntry({ sourceKey: "manual-a" }),
        instant("2026-08-07T06:30:00Z"),
      );
      const b = await store.addManualVenueEvent(
        manualEntry({ sourceKey: "manual-b" }),
        instant("2026-08-07T06:31:00Z"),
      );
      const rows = await store.readVenueEvents();
      expect(rows).toHaveLength(2);
      expect(a.uid).not.toBe(b.uid);
    });
  });

  it("a later scrape of a real source cannot touch a manual row", async () => {
    // The manual row shares only the (source, sourceKey) identity shape; it is
    // never in a scrape's output, so an unrelated upsert leaves it untouched.
    await withStore(async (store) => {
      const manual = await store.addManualVenueEvent(manualEntry(), instant("2026-08-07T06:30:00Z"));
      await store.upsertVenueEvent(
        {
          source: "suntec",
          sourceKey: "bni-vision1472026",
          name: "BNI Vision",
          start: instant("2026-07-17T04:00:00Z"),
          end: instant("2026-07-17T10:00:00Z"),
          venue: "Suntec Convention Centre",
          hall: null,
        },
        instant("2026-08-07T07:00:00Z"),
      );

      const stored = (await store.readVenueEvents()).find((r) => r.uid === manual.uid);
      expect(stored?.reviewed).toBe(true);
      expect(stored?.lastSeenAt).toBe("2026-08-07T06:30:00Z");
    });
  });
});
