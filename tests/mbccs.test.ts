import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PortCall, Scraped } from "../src/domain/types.js";
import { runPipeline } from "../src/pipeline/run.js";
import { mbccs, type MbccsRaw } from "../src/sources/mbccs.js";
import type { BrowserSession, FetchDeps, HttpClient, ParseResult } from "../src/sources/types.js";

/**
 * **Seam 2 — pure `parse` over a saved harvested payload, with an injected clock.**
 *
 * No browser, no network. `schedule.json` is the records MBCCS's React state
 * really held on 2026-07-21 (ADR-0005 Amendment 2 — the stable id lives there, not
 * in the DOM); the other three fixtures stage one outcome each the adapter has to
 * separate. `absent.json` is the one that matters most: it is the JSON equivalent
 * of SCC's Imperva challenge page — a read that failed, byte-plausible as a quiet
 * week — and the anchor is the only thing that tells the two apart.
 */

const fixture = (name: string): MbccsRaw =>
  JSON.parse(
    readFileSync(fileURLToPath(new URL(`./fixtures/mbccs/${name}`, import.meta.url)), "utf8"),
  ) as MbccsRaw;

/** Any clock. MBCCS publishes absolute UTC instants, so none of these depend on it. */
const NOW = new Date("2026-07-21T00:00:00Z");

const parsed = (name: string, now: Date = NOW): ParseResult<Scraped<PortCall>> =>
  mbccs.parse(fixture(name), now);

const recordsOf = (result: ParseResult<Scraped<PortCall>>): Scraped<PortCall>[] => {
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result.records;
};

const byKey = (result: ParseResult<Scraped<PortCall>>, key: string): Scraped<PortCall> => {
  const found = recordsOf(result).find((r) => r.sourceKey === key);
  if (!found) throw new Error(`no record keyed ${key}`);
  return found;
};

/**
 * A fake browser session that serves the harvested records without a real
 * Chromium — the browser counterpart to SCC's fake `http.get`. `Raw` being
 * adapter-owned is what makes this legal: the core cannot tell it skipped the
 * page. The `evaluate` expressions the adapter issues are distinguished by a token
 * each genuinely contains — the pager's `pointer-events-none`, the empty-state
 * text, else the record harvest — so the fake need not reproduce a real page. It
 * serves a single page: "next" is always disabled, so the pager walk harvests once.
 */
const fakeBrowser = (records: MbccsRaw["schedule"]) => {
  const goto: string[] = [];
  const clicked: string[] = [];
  const list = Array.isArray(records) ? records : [];
  const session: BrowserSession = {
    goto: async (url) => {
      goto.push(url);
    },
    click: async (selector) => {
      clicked.push(selector);
    },
    waitForFunction: async () => {},
    evaluate: async <T>(expression: string): Promise<T> => {
      if (expression.includes("next-month")) return true as T;
      if (expression.includes("pointer-events-none")) return false as T;
      if (expression.includes("no scheduled cruises")) return (records === null ? false : list.length === 0) as T;
      return (list.length > 0 ? list : null) as T;
    },
  };
  return { session, goto, clicked };
};

/** Refuses rather than fetches — MBCCS has no plain GET, so any call here is a bug. */
const noHttp: HttpClient = {
  get: async (url) => {
    throw new Error(`mbccs must not use http, but something GET ${url}`);
  },
};

// ---------------------------------------------------------------------------

describe("the adapter's shape", () => {
  it("identifies itself as mbccs", () => {
    expect(mbccs.key).toBe("mbccs");
  });

  it("is registered in the explicit array", async () => {
    const { sources } = await import("../src/sources/registry.js");
    expect(sources).toContain(mbccs);
  });

  it("drives the injected browser to the schedule and never touches http", async () => {
    const browser = fakeBrowser(fixture("schedule.json").schedule);
    const raw = await mbccs.fetch({ http: noHttp, now: () => NOW, browser: browser.session });

    expect(browser.goto).toEqual(["https://mbccs.com.sg/cruise-information?tab=cruise-schedule"]);
    // It operated the date filter — a plain GET could never reach this data.
    expect(browser.clicked.length).toBeGreaterThan(0);
    expect(raw.schedule).toHaveLength(3);
  });

  it("refuses to run without a browser rather than returning an empty schedule", async () => {
    // The adapter constructs nothing; a run that reaches it with no browser is a
    // wiring error, and an empty schedule would read as a quiet week (ADR-0006).
    const deps = { http: noHttp, now: () => NOW } satisfies FetchDeps;
    await expect(mbccs.fetch(deps)).rejects.toThrow(/browser/i);
  });
});

describe("parsing the real schedule", () => {
  it("reads every call the payload carries, with no failures", () => {
    const result = parsed("schedule.json");
    expect(recordsOf(result)).toHaveLength(3);
    expect(result.ok && result.failures).toEqual([]);
  });

  it("passes the already-UTC datetimes straight through, with no offset math", () => {
    // Unlike SCC's SGT columns, MBCCS publishes `…Z` — absolute instants.
    expect(byKey(parsed("schedule.json"), "e21dc665-714e-4e63-8c19-5384e785a771")).toMatchObject({
      arrival: "2026-07-20T23:00:00Z",
      departure: "2026-07-21T05:00:00Z",
    });
  });

  it("names the terminal as a constant, never scraped", () => {
    expect(recordsOf(parsed("schedule.json")).every((r) => r.terminal === "MBCCS")).toBe(true);
  });

  it("renders the numeric berthNo as the source's own Pier label", () => {
    // The payload carries `berthNo: 1`; the page renders it `Pier 1`. Stored in
    // that form to match SCC and demoted into the description, never the location.
    expect(recordsOf(parsed("schedule.json")).every((r) => r.berth === "Pier 1")).toBe(true);
  });

  it("labels every record with its own source", () => {
    expect(recordsOf(parsed("schedule.json")).every((r) => r.source === "mbccs")).toBe(true);
  });
});

describe("sourceKey", () => {
  it("is the raw id — a real, stable source identifier", () => {
    expect(recordsOf(parsed("schedule.json")).map((r) => r.sourceKey)).toContain(
      "e21dc665-714e-4e63-8c19-5384e785a771",
    );
  });

  it("keeps one vessel's two calls distinct, keyed on their different ids", () => {
    // Genting Dream calls twice in the window. SCC's `{vessel}|{date}` could merge
    // a same-day repeat; a real id cannot, which is the whole reason it beats one.
    const genting = recordsOf(parsed("schedule.json")).filter((r) => r.vessel === "Genting Dream");
    expect(genting).toHaveLength(2);
    expect(new Set(genting.map((r) => r.sourceKey)).size).toBe(2);
  });
});

describe("facts-only extraction", () => {
  it("mints no uid and no memory fields", () => {
    for (const record of recordsOf(parsed("schedule.json"))) {
      expect(record).not.toHaveProperty("uid");
      expect(record).not.toHaveProperty("sequence");
      expect(record).not.toHaveProperty("firstSeenAt");
      expect(record).not.toHaveProperty("lastSeenAt");
    }
  });

  it("reads neither the previous nor the next port, though both are in the payload", () => {
    // `lastPort` → `nextPort` is a tempting synthesised description. There is no
    // field on PortCall for it to land in, and inventing one would reopen ADR-0002.
    const values = recordsOf(parsed("schedule.json")).flatMap((r) => Object.values(r));
    for (const port of ["PORT KLANG", "SINGAPORE", "OTHER"]) {
      expect(values.some((v) => typeof v === "string" && v.includes(port))).toBe(false);
    }
  });

  it("carries no ship/line split and no duration field", () => {
    const record = recordsOf(parsed("schedule.json"))[0]!;
    expect(Object.keys(record).sort()).toEqual(
      ["arrival", "berth", "departure", "source", "sourceKey", "terminal", "vessel"].sort(),
    );
    expect(record).not.toHaveProperty("duration");
  });
});

describe("the three parse outcomes", () => {
  it("refuses an absent payload rather than reading it as a quiet week", () => {
    // The load-bearing assertion. `schedule: null` means fetch never located the
    // state — a redesign, a failed hydration, or not our page — and must not be
    // mistaken for MBCCS genuinely having no calls for three months.
    const result = parsed("absent.json");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/schedule/i);
    expect(result).not.toMatchObject({ ok: true, records: [] });
  });

  it("returns ok with no records for the genuine empty state", () => {
    // MBCCS renders 'There are no scheduled cruises'; fetch harvests it as []. The
    // only thing separating this from the absent payload above is the anchor.
    expect(parsed("empty.json")).toEqual({ ok: true, records: [], failures: [] });
  });

  it("lands the good record and surfaces the bad ones, dropping neither", () => {
    const result = parsed("malformed.json");
    const records = recordsOf(result);

    expect(records).toHaveLength(1);
    expect(records[0]?.vessel).toBe("Genting Dream");
    expect(result.ok && result.failures).toHaveLength(2);
  });

  it("does not silently drop a bad record", () => {
    // The heart of ADR-0006. A dropped record stops appearing, `lastSeenAt` stops
    // advancing, and a scraper defect becomes indistinguishable from an absence.
    const result = parsed("malformed.json");
    const failures = (result.ok && result.failures) || [];

    const berthingless = failures.find((f) => f.expected.includes("berthingDateTime"));
    expect(berthingless?.fragment).toContain("Spectrum of the Seas");
    // Read far enough to be keyed by its id, since `id` is the whole sourceKey.
    expect(berthingless?.sourceKey).toBe("b8c1f0a2-0000-4000-8000-000000000000");
  });

  it("keys no failure that never got as far as an id", () => {
    const failures = (
      parsed("malformed.json") as { failures: { sourceKey?: string; expected: string }[] }
    ).failures;
    const idless = failures.find((f) => f.expected.includes('"id"'));
    // No id read, so no key — carrying none rather than a half-made one.
    expect(idless?.sourceKey).toBeUndefined();
  });
});

describe("through the pipeline", () => {
  /**
   * The registered adapter, driven end to end through `runPipeline` — only the
   * browser is faked. `fetch` reads the injected session, `parse` maps the
   * harvested payload, the store mints uids, and the feed is written from the
   * store. MBCCS folds into the **existing** port-calls.ics; no new feed appears.
   */
  const runOverFixture = async (name = "schedule.json") => {
    const workspace = mkdtempSync(join(tmpdir(), "mbccs-"));
    const browser = fakeBrowser(fixture(name).schedule);

    const { outcomes } = await runPipeline({
      sources: [mbccs],
      db: join(workspace, "calendar.sqlite"),
      feedsDir: join(workspace, "feeds"),
      now: () => NOW,
      http: noHttp,
      browser: browser.session,
    });

    const feeds = join(workspace, "feeds");
    const result = {
      ics: readFileSync(join(feeds, "port-calls.ics"), "utf8"),
      feedNames: readdirSync(feeds).sort(),
      outcomes,
    };
    rmSync(workspace, { recursive: true, force: true });
    return result;
  };

  it("folds MBCCS calls into port-calls.ics and reports a clean outcome", async () => {
    const { ics, outcomes } = await runOverFixture();

    expect(outcomes).toEqual([{ source: "mbccs", ok: true, records: 3, failures: [] }]);
    expect(ics).toContain("X-WR-CALNAME:SG Cruise Arrivals");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(3);
    expect(ics).toContain("SUMMARY:Cruise: Genting Dream at MBCCS");
    expect(ics).toContain("LOCATION:MBCCS");
  });

  it("adds no new feed — the feed set grows with types, not sources", async () => {
    // #37: MBCCS port calls appear in the existing port-calls.ics, no new feed.
    expect((await runOverFixture()).feedNames).toEqual(["port-calls.ics", "venue-events.ics"]);
  });

  it("carries the berth into the description, never the location", async () => {
    const { ics } = await runOverFixture();
    expect(ics).toContain("Pier 1");
    expect(ics).not.toContain("LOCATION:MBCCS\\, Pier");
  });

  it("writes nothing when the schedule payload is absent", async () => {
    const { ics, outcomes } = await runOverFixture("absent.json");
    expect(outcomes[0]).toMatchObject({ source: "mbccs", ok: false });
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});

describe("purity", () => {
  it("returns the same records whatever the clock says", () => {
    // Absolute UTC instants, so `now` cannot move the answer and the fixture is
    // safe to age past the ~3-month window.
    const early = parsed("schedule.json", new Date("2020-01-01T00:00:00Z"));
    const late = parsed("schedule.json", new Date("2040-01-01T00:00:00Z"));
    expect(early).toEqual(late);
  });

  it("does not mutate the input", () => {
    const raw = fixture("schedule.json");
    const snapshot = JSON.stringify(raw);
    mbccs.parse(raw, NOW);
    expect(JSON.stringify(raw)).toBe(snapshot);
  });
});
