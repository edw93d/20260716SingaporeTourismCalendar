import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import Database from "better-sqlite3";
import { Client } from "pg";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { instant } from "../src/domain/instant.js";
import type { PortCall, Scraped, SourceId, VenueEvent } from "../src/domain/types.js";
import { runPipeline } from "../src/pipeline/run.js";
import { migrateFromV1 } from "../src/store/migrate.js";
import { openStore } from "../src/store/store.js";
import type { HttpClient, ParseResult, Source } from "../src/sources/types.js";
import { freshSchema, type EphemeralStore } from "./support/postgres.js";

/**
 * **Seam 1 — the whole pipeline run, now against a real Postgres.** Records go in
 * through a fixture adapter and land in the store; every assertion reads the
 * store back. The pipeline is a pure writer in v2 (ADR-0025 §4) — it emits no
 * `.ics` and no `calendar.json`, so nothing here reaches for a file. The store's
 * traps live in real SQL (the `ON CONFLICT` sequence bump, the upsert that must
 * not touch a moderation column, the migration column-copy), so the tests run
 * against a real ephemeral schema rather than a fake, exactly as v1's ran against
 * a real temp SQLite store.
 *
 * The adapters are fixtures rather than real scrapers **by design**. Every hard
 * behaviour at this seam is about memory across runs — uid durability, sequence
 * bumping, seen-tracking — and staging those through real HTML would mean
 * hand-editing fixtures to simulate a reschedule. A fixture adapter lets a
 * run-twice test state its scenario directly, which is what makes this seam
 * worth having.
 */

// ---------------------------------------------------------------------------
// Fixture adapters
// ---------------------------------------------------------------------------

/**
 * An adapter whose `fetch` hands back a canned `ParseResult` and whose `parse`
 * returns it unchanged. `Raw` being adapter-owned is what makes this legal: the
 * core cannot tell that this one skipped the network.
 */
const sourceReturning = <T extends VenueEvent | PortCall>(
  key: SourceId,
  result: ParseResult<Scraped<T>>,
): Source<T, ParseResult<Scraped<T>>> => ({
  key,
  fetch: async () => result,
  parse: (raw) => raw,
});

const venueSourceOf = (
  key: SourceId,
  records: Scraped<VenueEvent>[],
): Source<VenueEvent, ParseResult<Scraped<VenueEvent>>> =>
  sourceReturning(key, { ok: true, records, failures: [] });

const portCallSourceOf = (
  key: SourceId,
  records: Scraped<PortCall>[],
): Source<PortCall, ParseResult<Scraped<PortCall>>> =>
  sourceReturning(key, { ok: true, records, failures: [] });

const bniVision = (
  overrides: Partial<Scraped<VenueEvent>> = {},
): Scraped<VenueEvent> => ({
  source: "suntec",
  sourceKey: "bni-vision1472026",
  name: "BNI Vision",
  start: instant("2026-07-17T04:00:00Z"),
  end: instant("2026-07-17T10:00:00Z"),
  venue: "Suntec Convention Centre",
  hall: "Level 4, Hall 404",
  ...overrides,
});

const odyssey = (overrides: Partial<Scraped<PortCall>> = {}): Scraped<PortCall> => ({
  source: "scc",
  sourceKey: "ODYSSEY / VILLA VIE RESIDENCES|2026-07-18",
  vessel: "ODYSSEY / VILLA VIE RESIDENCES",
  terminal: "Singapore Cruise Centre",
  berth: "Pier 2",
  arrival: instant("2026-07-18T00:00:00Z"),
  departure: instant("2026-07-18T10:00:00Z"),
  ...overrides,
});

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

let schema: EphemeralStore;

beforeEach(async () => {
  schema = await freshSchema();
});

afterEach(async () => {
  await schema.drop();
});

const clockAt = (value: string) => () => new Date(value);

/**
 * Refuses rather than fetches. Every source in this file is a fake that serves
 * its own bytes, so any call here means a test reached for the network by
 * accident — and saying so loudly is the reason `http` is a required option.
 */
const noHttp: HttpClient = {
  get: async (url) => {
    throw new Error(`the pipeline tests must not make requests, but something GET ${url}`);
  },
};

const run = (sources: (Source<VenueEvent> | Source<PortCall>)[], at: string) =>
  runPipeline({
    sources,
    connectionString: schema.connectionString,
    now: clockAt(at),
    http: noHttp,
  });

/** Reads the database back the way a later run — or the operator — would. */
const storedVenueEvents = async () => {
  const store = await openStore(schema.connectionString);
  try {
    return await store.readVenueEvents();
  } finally {
    await store.close();
  }
};

const storedPortCalls = async () => {
  const store = await openStore(schema.connectionString);
  try {
    return await store.readPortCalls();
  } finally {
    await store.close();
  }
};

/** The run-marker the pipeline stamps, read back the way the server would. */
const storedLastRun = async () => {
  const store = await openStore(schema.connectionString);
  try {
    return await store.lastRun();
  } finally {
    await store.close();
  }
};

/** A raw client on this test's schema, for the SQL a store method deliberately cannot express. */
const withClient = async <T>(work: (client: Client) => Promise<T>): Promise<T> => {
  const client = new Client({ connectionString: schema.connectionString });
  await client.connect();
  try {
    return await work(client);
  } finally {
    await client.end();
  }
};

const RUN_ONE = "2026-07-01T02:00:00Z";
const RUN_TWO = "2026-07-02T02:00:00Z";
const RUN_THREE = "2026-07-03T02:00:00Z";

// ---------------------------------------------------------------------------

describe("the store", () => {
  it("persists both record types, keyed on (source, sourceKey)", async () => {
    await run([venueSourceOf("suntec", [bniVision()]), portCallSourceOf("scc", [odyssey()])], RUN_ONE);

    expect(await storedVenueEvents()).toMatchObject([
      { source: "suntec", sourceKey: "bni-vision1472026", name: "BNI Vision" },
    ]);
    expect(await storedPortCalls()).toMatchObject([
      { source: "scc", vessel: "ODYSSEY / VILLA VIE RESIDENCES" },
    ]);
  });

  it("treats the same sourceKey under a different source as a different record", async () => {
    // Duplicates are accepted and labelled by source (ADR-0004), so identity is
    // the pair — never the key alone.
    await run(
      [
        venueSourceOf("suntec", [bniVision()]),
        venueSourceOf("expo", [bniVision({ source: "expo", venue: "Singapore EXPO" })]),
      ],
      RUN_ONE,
    );

    const stored = await storedVenueEvents();
    expect(stored).toHaveLength(2);
    expect(new Set(stored.map((r) => r.uid)).size).toBe(2);
  });

  it("writes no status field of any kind", async () => {
    // Seen-tracking refuses to resolve absence into a status the source never
    // stated. A column would be the first place that refusal leaks.
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);

    const columns = await withClient(async (client) => {
      const { rows } = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name IN ('venue_event', 'port_call')`,
      );
      return rows.map((row) => row["column_name"] as string);
    });
    expect(columns.filter((c) => /status|state|deleted|cancelled|active/i.test(c))).toEqual([]);
  });
});

describe("per-source transactions", () => {
  it("rolls the whole transaction back when its work throws", async () => {
    // One transaction per source (ADR-0025 §5): a source that breaks mid-write
    // rolls back its own records and no others, so a run never leaves a
    // half-written source behind. A `transact` that committed regardless — or
    // omitted the ROLLBACK — would leave the first upsert stranded here.
    const store = await openStore(schema.connectionString);
    try {
      await expect(
        store.transact(async (tx) => {
          await tx.upsertVenueEvent(bniVision({ sourceKey: "a" }), instant(RUN_ONE));
          throw new Error("source broke mid-write");
        }),
      ).rejects.toThrow("source broke mid-write");

      expect(await store.readVenueEvents()).toEqual([]);
    } finally {
      await store.close();
    }
  });

  it("commits every record when the work completes", async () => {
    const store = await openStore(schema.connectionString);
    try {
      await store.transact(async (tx) => {
        await tx.upsertVenueEvent(bniVision({ sourceKey: "a", name: "A" }), instant(RUN_ONE));
        await tx.upsertVenueEvent(bniVision({ sourceKey: "b", name: "B" }), instant(RUN_ONE));
      });

      expect((await store.readVenueEvents()).map((r) => r.name).sort()).toEqual(["A", "B"]);
    } finally {
      await store.close();
    }
  });
});

describe("the upsert writes only the fields Scraped<T> carries", () => {
  it("never clobbers a person-set column a scrape does not own", async () => {
    // ⚠️ The one storage-shaped trap on the ticket (ADR-0025 §5). #4 adds a
    // person-set `hidden` flag; a scrape that overwrote it would silently un-do
    // every moderation judgement on the next run. `hidden` does not exist yet, so
    // this simulates it: add the column, hide a record, then re-scrape it with
    // changed content. The upsert's SET clause names only content, sequence and
    // last_seen_at — so `hidden` must survive untouched while the content moves.
    // A `SELECT *`-style write, or one that widened the column list, fails here.
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);

    await withClient((client) =>
      client.query(`ALTER TABLE venue_event ADD COLUMN hidden boolean NOT NULL DEFAULT false`),
    );
    await withClient((client) => client.query(`UPDATE venue_event SET hidden = true`));

    await run([venueSourceOf("suntec", [bniVision({ name: "BNI Vision 2026" })])], RUN_TWO);

    const [after] = await storedVenueEvents();
    const hidden = await withClient(async (client) => {
      const { rows } = await client.query(`SELECT hidden FROM venue_event`);
      return rows[0]?.["hidden"] as boolean;
    });

    expect(hidden).toBe(true);
    expect(after?.name).toBe("BNI Vision 2026");
    expect(after?.sequence).toBe(1);
  });
});

describe("uid durability", () => {
  it("mints a uid once and never recomputes it", async () => {
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);
    const [first] = await storedVenueEvents();

    await run([venueSourceOf("suntec", [bniVision()])], RUN_TWO);
    const [second] = await storedVenueEvents();

    expect(second?.uid).toBe(first?.uid);
    expect(first?.uid).toBeTruthy();
  });

  it("moves a rescheduled record rather than duplicating it", async () => {
    // The change subscribers most need delivered as an update. Hashing `start`
    // into the uid would deliver it as a second entry beside a stale one.
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);
    const [before] = await storedVenueEvents();

    await run(
      [
        venueSourceOf("suntec", [
          bniVision({
            start: instant("2026-08-17T04:00:00Z"),
            end: instant("2026-08-17T10:00:00Z"),
          }),
        ]),
      ],
      RUN_TWO,
    );

    const stored = await storedVenueEvents();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.uid).toBe(before?.uid);
    expect(stored[0]?.sequence).toBe((before?.sequence ?? 0) + 1);
    expect(stored[0]?.start).toBe("2026-08-17T04:00:00Z");
  });

  it("keeps the uid when a title is corrected, and bumps sequence", async () => {
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);
    const [before] = await storedVenueEvents();

    await run([venueSourceOf("suntec", [bniVision({ name: "BNI Vision 2026" })])], RUN_TWO);

    const [after] = await storedVenueEvents();
    expect(after?.uid).toBe(before?.uid);
    expect(after?.sequence).toBe((before?.sequence ?? 0) + 1);
    expect(after?.name).toBe("BNI Vision 2026");
  });

  it("leaves sequence alone when nothing changed", async () => {
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);
    await run([venueSourceOf("suntec", [bniVision()])], RUN_TWO);

    expect((await storedVenueEvents())[0]?.sequence).toBe(0);
  });
});

describe("seen-tracking", () => {
  it("fixes firstSeenAt at first sight and advances lastSeenAt on every sighting", async () => {
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);
    await run([venueSourceOf("suntec", [bniVision()])], RUN_TWO);

    expect((await storedVenueEvents())[0]).toMatchObject({
      firstSeenAt: RUN_ONE,
      lastSeenAt: RUN_TWO,
    });
  });

  it("never hard-deletes a record that stops appearing", async () => {
    // Absence could mean cancelled, rescheduled, scrolled past the window, or a
    // silently broken scraper. The source never says which, so the model records
    // the observation and refuses to infer.
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);
    await run([venueSourceOf("suntec", [])], RUN_TWO);

    const stored = await storedVenueEvents();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ firstSeenAt: RUN_ONE, lastSeenAt: RUN_ONE });
  });

  it("preserves the uid across a disappearance and reappearance", async () => {
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);
    const [minted] = await storedVenueEvents();

    await run([venueSourceOf("suntec", [])], RUN_TWO);
    await run([venueSourceOf("suntec", [bniVision()])], RUN_THREE);

    expect((await storedVenueEvents())[0]).toMatchObject({
      uid: minted?.uid,
      firstSeenAt: RUN_ONE,
      lastSeenAt: RUN_THREE,
    });
  });
});

describe("parse outcomes", () => {
  it("does not read `ok: false` as an empty source", async () => {
    // The Imperva challenge page returns HTTP 200, so a not-ok parse is
    // byte-plausible as a quiet week. Advancing lastSeenAt past it — or worse,
    // treating every record as vanished — would launder a defence into an
    // observation.
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);

    await run(
      [
        sourceReturning<VenueEvent>("suntec", {
          ok: false,
          reason: "listing anchor absent — likely a challenge page",
        }),
      ],
      RUN_TWO,
    );

    expect((await storedVenueEvents())[0]).toMatchObject({
      firstSeenAt: RUN_ONE,
      lastSeenAt: RUN_ONE,
    });
  });

  it("lands the good records when some rows failed to parse", async () => {
    await run(
      [
        sourceReturning<VenueEvent>("suntec", {
          ok: true,
          records: [bniVision()],
          failures: [{ fragment: "<article/>", expected: "a start instant" }],
        }),
      ],
      RUN_ONE,
    );

    expect(await storedVenueEvents()).toHaveLength(1);
  });

  it("reports what each source did, so a bad reading is not swallowed", async () => {
    const { outcomes } = await run(
      [
        sourceReturning<VenueEvent>("suntec", {
          ok: true,
          records: [bniVision()],
          failures: [{ fragment: "<article/>", expected: "a start instant" }],
        }),
        sourceReturning<VenueEvent>("expo", { ok: false, reason: "listing anchor absent" }),
      ],
      RUN_ONE,
    );

    expect(outcomes).toEqual([
      {
        source: "suntec",
        ok: true,
        records: 1,
        failures: [{ fragment: "<article/>", expected: "a start instant" }],
      },
      { source: "expo", ok: false, reason: "listing anchor absent" },
    ]);
  });

  it("does not let one unreachable source cost every other source its reading", async () => {
    const unreachable: Source<VenueEvent> = {
      key: "scc",
      fetch: async () => {
        throw new Error("connect ETIMEDOUT");
      },
      parse: () => ({ ok: true, records: [], failures: [] }),
    };

    const { outcomes } = await run(
      [unreachable, venueSourceOf("suntec", [bniVision()])],
      RUN_ONE,
    );

    expect(outcomes[0]).toMatchObject({ source: "scc", ok: false });
    expect(outcomes[0]).toHaveProperty("reason", expect.stringContaining("ETIMEDOUT"));
    expect(await storedVenueEvents()).toHaveLength(1);
  });

});

describe("the run-marker (#154, ADR-0013)", () => {
  it("stamps the run instant so the served payload carries a live generatedAt", async () => {
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);
    expect(await storedLastRun()).toBe(instant(RUN_ONE));
  });

  it("advances the marker even when every source is unreadable", async () => {
    // Freshness is a property of the publish, not of any source: a run in which
    // every scraper broke still ran to completion and published on time, so the
    // marker must advance and the alarm stay quiet. A marker read off a source's
    // `lastSeenAt` would freeze here and fire on a calendar that ran perfectly.
    const unreadable = (key: SourceId): Source<VenueEvent> => ({
      key,
      fetch: async () => {
        throw new Error("connect ETIMEDOUT");
      },
      parse: () => ({ ok: true, records: [], failures: [] }),
    });

    const { outcomes } = await run([unreadable("suntec"), unreadable("scc")], RUN_TWO);

    expect(outcomes.every((outcome) => !outcome.ok)).toBe(true);
    expect(await storedLastRun()).toBe(instant(RUN_TWO));
  });

  it("advances the marker to the newest run across runs", async () => {
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);
    await run([venueSourceOf("suntec", [bniVision()])], RUN_THREE);
    expect(await storedLastRun()).toBe(instant(RUN_THREE));
  });

  it("leaves the marker untouched on a single-source on-demand run", async () => {
    // Only a full run advances the marker (ADR-0028 §8). A by-hand poke of one
    // source — `full: false`, the subset path the entry point takes from
    // `selectRun` — must not bump `generatedAt`: reading a one-source poke as
    // proof the whole calendar refreshed is exactly how a dead nightly run would
    // go unseen, the silent-staleness failure the freshness watcher exists to
    // catch. The scrape still lands; only the marker holds.
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);
    expect(await storedLastRun()).toBe(instant(RUN_ONE));

    await runPipeline({
      sources: [venueSourceOf("scc", [bniVision({ source: "scc" })])],
      connectionString: schema.connectionString,
      now: clockAt(RUN_TWO),
      http: noHttp,
      full: false,
    });

    // The subset run wrote its record, but did not move the marker off RUN_ONE.
    expect(await storedVenueEvents()).toHaveLength(2);
    expect(await storedLastRun()).toBe(instant(RUN_ONE));
  });
});

describe("retention", () => {
  it("keeps a record whose end is in the past — retention is unbounded", async () => {
    const lastYear = bniVision({
      sourceKey: "cellar-fiesta1462025",
      name: "Cellar Fiesta",
      start: instant("2025-06-14T04:00:00Z"),
      end: instant("2025-06-14T10:00:00Z"),
    });

    await run([venueSourceOf("suntec", [lastYear])], RUN_ONE);

    const stored = await storedVenueEvents();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.name).toBe("Cellar Fiesta");
  });
});

describe("idempotence", () => {
  it("produces identical state on a re-run", async () => {
    // A dropped run must cost freshness and nothing else, so the scrape has to
    // be safe to repeat.
    const fixtures = () => [
      venueSourceOf("suntec", [bniVision()]),
      portCallSourceOf("scc", [odyssey()]),
    ];

    await run(fixtures(), RUN_ONE);
    const firstVenueEvents = await storedVenueEvents();
    const firstPortCalls = await storedPortCalls();

    await run(fixtures(), RUN_ONE);

    expect(await storedVenueEvents()).toEqual(firstVenueEvents);
    expect(await storedPortCalls()).toEqual(firstPortCalls);
  });

  it("self-heals a dropped run, costing freshness and nothing else", async () => {
    // GitHub drops scheduled runs under load, so a day on which the pipeline
    // simply never fires is expected rather than exceptional. The next run has
    // to absorb that: re-minting a uid would land a duplicate in every
    // subscriber's calendar, which is a far worse outcome than a stale one.
    //
    // Distinct from the re-run above: that repeats a run at the *same* instant,
    // this skips one entirely and resumes at a later one, which is the only
    // shape in which `lastSeenAt` has a gap to be wrong about.
    const fixtures = () => [venueSourceOf("suntec", [bniVision()])];

    await run(fixtures(), RUN_ONE);
    const before = await storedVenueEvents();

    // Nothing runs at RUN_TWO. The scheduled run was dropped.
    await run(fixtures(), RUN_THREE);
    const after = await storedVenueEvents();

    expect(after).toHaveLength(before.length);
    expect(after.map((record) => record.uid)).toEqual(before.map((record) => record.uid));
    // Content did not change while we were not looking, so nothing is an update.
    expect(after.map((record) => record.sequence)).toEqual(before.map((record) => record.sequence));
    expect(after.map((record) => record.firstSeenAt)).toEqual(
      before.map((record) => record.firstSeenAt),
    );
    // The one thing that does move — and it moves to now, not to the run we lost.
    expect(after.map((record) => record.lastSeenAt)).toEqual([instant(RUN_THREE)]);
  });

  it("orders records deterministically regardless of the order sources are read", async () => {
    const later = bniVision({ sourceKey: "later", name: "Later", start: instant("2026-09-01T04:00:00Z"), end: instant("2026-09-01T10:00:00Z") });

    await run([venueSourceOf("suntec", [bniVision(), later])], RUN_ONE);
    const forwards = (await storedVenueEvents()).map((r) => r.name);

    await schema.drop();
    schema = await freshSchema();

    await run([venueSourceOf("suntec", [later, bniVision()])], RUN_ONE);
    const backwards = (await storedVenueEvents()).map((r) => r.name);

    expect(forwards).toEqual(["BNI Vision", "Later"]);
    expect(backwards).toEqual(forwards);
  });
});

describe("breakage detection", () => {
  // Every record here ends well after both run instants, so it sits in the
  // future-dated cohort the drop is measured against (ADR-0007 §2).
  const future = (key: string): Scraped<VenueEvent> =>
    bniVision({
      sourceKey: key,
      name: key,
      start: instant("2026-09-01T04:00:00Z"),
      end: instant("2026-09-01T10:00:00Z"),
    });

  const futureCohort = (n: number): Scraped<VenueEvent>[] =>
    Array.from({ length: n }, (_, i) => future(`event-${i}`));

  const signalsFor = (run: Awaited<ReturnType<typeof runPipeline>>, source: SourceId) =>
    run.breakage.find((entry) => entry.source === source)?.signals ?? [];

  it("stays silent on a cold start — the first run has no cohort to drop from", async () => {
    const first = await run([venueSourceOf("suntec", futureCohort(20))], RUN_ONE);
    expect(signalsFor(first, "suntec")).toEqual([]);
  });

  it("raises a cohort-drop when the future cohort collapses across runs", async () => {
    // The quiet redesign ADR-0006 cannot catch: anchor still matches, rows drop,
    // every survivor parses cleanly. Twenty upcoming events fall to two.
    await run([venueSourceOf("suntec", futureCohort(20))], RUN_ONE);
    const second = await run([venueSourceOf("suntec", futureCohort(2))], RUN_TWO);

    expect(signalsFor(second, "suntec")).toEqual([
      { kind: "cohort-drop", vanished: 18, appeared: 0 },
    ]);
  });

  it("does not fire when appearances offset vanishings — the reschedule shape", async () => {
    // SCC's `sourceKey` makes a reschedule a delete-plus-create: one dated key
    // out, one dated key in, net zero. Netting silences it by construction.
    const before = [
      odyssey({ sourceKey: "SHIP|2026-09-01", departure: instant("2026-09-01T10:00:00Z") }),
    ];
    const after = [
      odyssey({ sourceKey: "SHIP|2026-09-02", departure: instant("2026-09-02T10:00:00Z") }),
    ];

    await run([portCallSourceOf("scc", before)], RUN_ONE);
    const second = await run([portCallSourceOf("scc", after)], RUN_TWO);

    expect(signalsFor(second, "scc")).toEqual([]);
  });

  it("does not treat a source that genuinely publishes nothing as broken", async () => {
    // Empty both runs: emptiness is not a signal, only a drop from a populated
    // cohort is (ADR-0006 — "genuinely empty. A fact.").
    await run([venueSourceOf("suntec", [])], RUN_ONE);
    const second = await run([venueSourceOf("suntec", [])], RUN_TWO);

    expect(signalsFor(second, "suntec")).toEqual([]);
  });

  it("raises an unreadable signal for a not-ok parse and skips drift detection", async () => {
    // A challenge page returns HTTP 200 and reads as a 100% drop; the honest
    // report is "the page isn't ours", with no mass-cancellation alert stacked on.
    await run([venueSourceOf("suntec", futureCohort(20))], RUN_ONE);
    const second = await run(
      [
        sourceReturning<VenueEvent>("suntec", {
          ok: false,
          reason: "listing anchor absent — likely a challenge page",
        }),
      ],
      RUN_TWO,
    );

    expect(signalsFor(second, "suntec")).toEqual([
      { kind: "unreadable", reason: "listing anchor absent — likely a challenge page" },
    ]);
  });

  it("raises an unreadable signal when fetch throws post-retry", async () => {
    const unreachable: Source<VenueEvent> = {
      key: "suntec",
      fetch: async () => {
        throw new Error("connect ETIMEDOUT");
      },
      parse: () => ({ ok: true, records: [], failures: [] }),
    };

    const first = await run([unreachable], RUN_ONE);
    const [signal] = signalsFor(first, "suntec");
    expect(signal).toMatchObject({ kind: "unreadable" });
    expect(signal).toHaveProperty("reason", expect.stringContaining("ETIMEDOUT"));
  });

  it("raises a rows-failed signal carrying the fragment and what was expected", async () => {
    // Debuggable without re-scraping: the failing material and the parser's
    // expectation travel with the signal.
    const failure = { fragment: "<article data-bad/>", expected: "a start instant" };
    const first = await run(
      [
        sourceReturning<VenueEvent>("suntec", {
          ok: true,
          records: [future("event-0")],
          failures: [failure],
        }),
      ],
      RUN_ONE,
    );

    expect(signalsFor(first, "suntec")).toEqual([{ kind: "rows-failed", failures: [failure] }]);
  });
});

// ---------------------------------------------------------------------------
// The migration from v1's SQLite store (ADR-0025 §7).
// ---------------------------------------------------------------------------

describe("migration from v1", () => {
  let v1Dir: string;
  let v1Path: string;

  beforeEach(() => {
    v1Dir = mkdtempSync(join(tmpdir(), "sg-v1-"));
    v1Path = join(v1Dir, "calendar.sqlite");
  });

  afterEach(() => {
    rmSync(v1Dir, { recursive: true, force: true });
  });

  /** A v1-shaped SQLite store, seeded with rows carrying their minted identity. */
  const seedV1 = () => {
    const db = new Database(v1Path);
    db.exec(`
      CREATE TABLE venue_event (
        source text NOT NULL, source_key text NOT NULL, uid text NOT NULL UNIQUE,
        sequence integer NOT NULL, name text NOT NULL, start_at text NOT NULL,
        end_at text NOT NULL, venue text NOT NULL, hall text,
        first_seen_at text NOT NULL, last_seen_at text NOT NULL,
        PRIMARY KEY (source, source_key)
      );
      CREATE TABLE port_call (
        source text NOT NULL, source_key text NOT NULL, uid text NOT NULL UNIQUE,
        sequence integer NOT NULL, vessel text NOT NULL, terminal text NOT NULL,
        berth text, arrival_at text NOT NULL, departure_at text NOT NULL,
        first_seen_at text NOT NULL, last_seen_at text NOT NULL,
        PRIMARY KEY (source, source_key)
      );
    `);
    db.prepare(
      `INSERT INTO venue_event VALUES
        ('suntec','bni-vision1472026','uid-ve-1@sg-tourism-calendar',3,'BNI Vision',
         '2026-07-17T04:00:00Z','2026-07-17T10:00:00Z','Suntec Convention Centre','Level 4, Hall 404',
         '2026-01-02T02:00:00Z','2026-07-01T02:00:00Z')`,
    ).run();
    db.prepare(
      `INSERT INTO port_call VALUES
        ('scc','ODYSSEY|2026-07-18','uid-pc-1@sg-tourism-calendar',0,'ODYSSEY / VILLA VIE RESIDENCES',
         'Singapore Cruise Centre','Pier 2','2026-07-18T00:00:00Z','2026-07-18T10:00:00Z',
         '2026-03-04T02:00:00Z','2026-07-01T02:00:00Z')`,
    ).run();
    db.close();
  };

  it("copies every record carrying uid, sequence, firstSeenAt and lastSeenAt untouched", async () => {
    // ADR-0004: the uid is minted once and never recomputed; v1's public feed
    // served real uids to real subscribers, so a re-mint would replace every
    // subscribed entry. The migration is a column copy — this asserts the four
    // durable fields arrive byte-for-byte, which fails the instant the migration
    // routes through the scrape upsert (which mints a new uid and resets
    // firstSeenAt).
    seedV1();

    const counts = await migrateFromV1(v1Path, schema.connectionString);
    expect(counts).toEqual({ venueEvents: 1, portCalls: 1 });

    expect(await storedVenueEvents()).toEqual([
      {
        uid: "uid-ve-1@sg-tourism-calendar",
        sequence: 3,
        source: "suntec",
        sourceKey: "bni-vision1472026",
        name: "BNI Vision",
        start: "2026-07-17T04:00:00Z",
        end: "2026-07-17T10:00:00Z",
        venue: "Suntec Convention Centre",
        hall: "Level 4, Hall 404",
        firstSeenAt: "2026-01-02T02:00:00Z",
        lastSeenAt: "2026-07-01T02:00:00Z",
      },
    ]);
    expect(await storedPortCalls()).toEqual([
      {
        uid: "uid-pc-1@sg-tourism-calendar",
        sequence: 0,
        source: "scc",
        sourceKey: "ODYSSEY|2026-07-18",
        vessel: "ODYSSEY / VILLA VIE RESIDENCES",
        terminal: "Singapore Cruise Centre",
        berth: "Pier 2",
        arrival: "2026-07-18T00:00:00Z",
        departure: "2026-07-18T10:00:00Z",
        firstSeenAt: "2026-03-04T02:00:00Z",
        lastSeenAt: "2026-07-01T02:00:00Z",
      },
    ]);
  });

  it("is idempotent — a second run re-mints nothing and changes no uid", async () => {
    // A migration is a one-shot, but a partial run that gets re-run must not
    // duplicate or re-mint. ON CONFLICT DO NOTHING preserves the first copy's
    // uid; a DO UPDATE, or a plain INSERT, would either overwrite or throw.
    seedV1();

    await migrateFromV1(v1Path, schema.connectionString);
    const [firstPass] = await storedVenueEvents();

    const counts = await migrateFromV1(v1Path, schema.connectionString);
    const [secondPass] = await storedVenueEvents();

    expect(counts).toEqual({ venueEvents: 1, portCalls: 1 });
    expect(secondPass?.uid).toBe(firstPass?.uid);
    expect(await storedVenueEvents()).toHaveLength(1);
  });

  it("hands migrated records straight to a normal scrape, which bumps sequence on change", async () => {
    // The migration is the substrate a live run sits on: after it, a scrape of a
    // migrated record with changed content keeps the migrated uid and bumps the
    // migrated sequence — proof the copied identity is a first-class store row,
    // not a special case.
    seedV1();
    await migrateFromV1(v1Path, schema.connectionString);
    const [migrated] = await storedVenueEvents();

    await run([venueSourceOf("suntec", [bniVision({ name: "BNI Vision 2026" })])], RUN_TWO);

    const [after] = await storedVenueEvents();
    expect(after?.uid).toBe(migrated?.uid);
    expect(after?.sequence).toBe(4);
    expect(after?.name).toBe("BNI Vision 2026");
  });
});
