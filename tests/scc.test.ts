import { mkdtempSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { PortCall, Scraped } from "../src/domain/types.js";
import { runPipeline } from "../src/pipeline/run.js";
import { scc } from "../src/sources/scc.js";
import type { FetchDeps, ParseResult } from "../src/sources/types.js";

/**
 * **Seam 2 — pure `parse` over saved fixture HTML, with an injected clock.**
 *
 * No network. `schedule.html` is bytes Singapore Cruise Centre really served on
 * 2026-07-20; the other three fixtures are minimal edits of them, each staging
 * one outcome the adapter has to separate.
 *
 * The one that matters most is `imperva-challenge.html`. SCC's WAF is passive
 * today and one switch-flip from defending, its challenge page is served with
 * **HTTP 200**, and it is byte-plausible as a quiet week. The structural anchor
 * is the only thing that tells the two apart — so it is asserted here against a
 * saved challenge page rather than trusted to a comment.
 */

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/scc/${name}`, import.meta.url)), "utf8");

/** Any clock. SCC publishes absolute dates in a fixed +08:00 zone, so none of these depend on it. */
const NOW = new Date("2026-07-20T05:00:00Z");

const parsed = (name: string, now: Date = NOW): ParseResult<Scraped<PortCall>> =>
  scc.parse(fixture(name), now);

/** Narrows to the ok arm and fails loudly rather than silently skipping assertions. */
const recordsOf = (result: ParseResult<Scraped<PortCall>>): Scraped<PortCall>[] => {
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result.records;
};

const byKey = (result: ParseResult<Scraped<PortCall>>, key: string): Scraped<PortCall> => {
  const found = recordsOf(result).find((r) => r.sourceKey === key);
  if (!found) throw new Error(`no record keyed ${key}`);
  return found;
};

// ---------------------------------------------------------------------------

describe("the adapter's shape", () => {
  it("identifies itself as scc", () => {
    expect(scc.key).toBe("scc");
  });

  it("is registered in the explicit array", async () => {
    const { sources } = await import("../src/sources/registry.js");
    expect(sources).toContain(scc);
  });

  it("performs exactly one GET and never touches a browser", async () => {
    const urls: string[] = [];
    const deps = {
      http: {
        get: async (url: string) => {
          urls.push(url);
          return "<html/>";
        },
      },
      now: () => NOW,
    } satisfies FetchDeps;

    await scc.fetch(deps);

    expect(urls).toEqual(["https://singaporecruise.com.sg/schedule/cruise/"]);
    // Server-rendered. Headless is MBCCS's and nothing else's, so this adapter
    // is not even offered the option.
    expect(deps).not.toHaveProperty("browser");
  });
});

describe("parsing the real schedule", () => {
  it("reads every sailing the fixture carries, with no failures", () => {
    const result = parsed("schedule.html");
    expect(recordsOf(result)).toHaveLength(17);
    expect(result.ok && result.failures).toEqual([]);
  });

  it("reads arrival and departure as UTC instants, converted from published SGT", () => {
    // `Thu, 30 Jul 2026  0800` → `Sat, 1 Aug 2026  1900`, both local +08:00.
    expect(recordsOf(parsed("schedule.html"))[0]).toMatchObject({
      arrival: "2026-07-30T00:00:00Z",
      departure: "2026-08-01T11:00:00Z",
    });
  });

  it("keeps the published clock time rather than a midnight", () => {
    const records = recordsOf(parsed("schedule.html"));
    expect(records.every((r) => r.arrival.endsWith("T00:00:00Z"))).toBe(false);
  });

  it("names the terminal as a constant, never scraped", () => {
    expect(
      recordsOf(parsed("schedule.html")).every((r) => r.terminal === "Singapore Cruise Centre"),
    ).toBe(true);
  });

  it("reports a null berth, because this table publishes no berth column", () => {
    // Nullable, never a fabricated default. MBCCS publishes `berthNo`; SCC's five
    // columns are arrival, departure, ship/line, from and next.
    expect(recordsOf(parsed("schedule.html")).every((r) => r.berth === null)).toBe(true);
    expect(fixture("schedule.html")).not.toMatch(/data-label="BERTH"/i);
  });

  it("labels every record with its own source", () => {
    expect(recordsOf(parsed("schedule.html")).every((r) => r.source === "scc")).toBe(true);
  });
});

describe("vessel", () => {
  it("stores the cell as published, ship and line unsplit", () => {
    // `CONTEXT.md` § PortCall: ship names are multi-word and the delimiter is
    // whitespace only, so no rule splits this reliably — and a bad split would
    // silently corrupt `sourceKey`.
    const vessels = recordsOf(parsed("schedule.html")).map((r) => r.vessel);
    expect(vessels).toContain("ODYSSEY VILLA VIE RESIDENCES");
    expect(vessels).toContain(
      "GINGA MARU JAPAN AGENCY OF MARITIME EDUCATION AND TRAINING FOR SEAFARERS",
    );
  });

  it("attempts no ship/line split anywhere in the record", () => {
    const record = recordsOf(parsed("schedule.html"))[0]!;
    expect(Object.keys(record).sort()).toEqual(
      ["arrival", "berth", "departure", "source", "sourceKey", "terminal", "vessel"].sort(),
    );
    expect(record).not.toHaveProperty("ship");
    expect(record).not.toHaveProperty("line");
  });

  it("drops the line's logo without dropping the vessel beside it", () => {
    // Some rows lead with an `<img>` of the line's logo. Read naively, the vessel
    // arrives with a wp-content URL welded to its front — and from there into the
    // sourceKey, permanently.
    expect(fixture("schedule.html")).toContain("banner-schedule__table-image");

    const vessels = recordsOf(parsed("schedule.html")).map((r) => r.vessel);
    expect(vessels).toContain("AEGEAN PARADISE NEW CENTURY TOURS");
    expect(vessels.some((v) => v.includes("wp-content") || v.includes("<"))).toBe(false);
  });
});

describe("sourceKey", () => {
  it("is vessel and arrival date, joined by a pipe", () => {
    expect(recordsOf(parsed("schedule.html")).map((r) => r.sourceKey)).toContain(
      "AEGEAN PARADISE NEW CENTURY TOURS|2026-08-12",
    );
  });

  it("dates the key by the day the source published, not by the UTC instant", () => {
    // `Tue, 8 Sep 2026  0700` SGT is 2026-09-07T23:00:00Z. Keying off the UTC
    // date would move this record to the 7th — a key that disagrees with the page
    // it was read from, and one that shifts under a source that only ever
    // publishes early-morning local calls.
    const record = byKey(parsed("schedule.html"), "STAR VOYAGER STAR CRUISES|2026-09-08");
    expect(record.arrival).toBe("2026-09-07T23:00:00Z");
  });

  it("is unique across the schedule, including a vessel calling nine times", () => {
    const keys = recordsOf(parsed("schedule.html")).map((r) => r.sourceKey);
    expect(keys.filter((k) => k.startsWith("STAR VOYAGER"))).toHaveLength(9);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("facts-only extraction", () => {
  it("mints no uid and no memory fields", () => {
    for (const record of recordsOf(parsed("schedule.html"))) {
      expect(record).not.toHaveProperty("uid");
      expect(record).not.toHaveProperty("sequence");
      expect(record).not.toHaveProperty("firstSeenAt");
      expect(record).not.toHaveProperty("lastSeenAt");
    }
  });

  it("reads neither the previous nor the next port, though both are in the row", () => {
    // `FROM` → `NEXT` is a tempting synthesised description. There is no field on
    // PortCall for it to land in, and inventing one would reopen ADR-0002.
    expect(fixture("schedule.html")).toContain("Vung Tau");

    const values = recordsOf(parsed("schedule.html")).flatMap((r) => Object.values(r));
    expect(values.some((v) => typeof v === "string" && v.includes("Vung Tau"))).toBe(false);
    expect(values.some((v) => typeof v === "string" && v.includes("Thailand"))).toBe(false);
  });
});

describe("the three parse outcomes", () => {
  it("refuses a saved Imperva challenge page rather than reading it as a quiet week", () => {
    // The load-bearing assertion of this adapter. Served with HTTP 200 and
    // carrying no rows, so a row-counting parser reports `ok: true, records: []`
    // — an assertion that no ship calls at Singapore for three months, made by a
    // scraper that never saw the schedule.
    const result = parsed("imperva-challenge.html");

    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/table/i);
    expect(result).not.toMatchObject({ ok: true, records: [] });
  });

  it("returns ok with no records when the table is present and empty", () => {
    // A genuinely quiet window is a fact about the source. The only thing
    // separating this document from the challenge page above is the anchor.
    expect(parsed("empty-table.html")).toEqual({ ok: true, records: [], failures: [] });
  });

  it("checks the anchor before examining any row", () => {
    // Rows without the schedule table are not our document. Reading them anyway
    // would launder a redesign into a partial success.
    const rowsWithoutAnchor = fixture("schedule.html").replace(
      /<table class="schedule-table schedule-table_cruise">/,
      "<table>",
    );
    expect(scc.parse(rowsWithoutAnchor, NOW).ok).toBe(false);
  });

  it("returns the good record plus a failure when one row is malformed", () => {
    const result = parsed("malformed-row.html");
    const records = recordsOf(result);

    expect(records).toHaveLength(1);
    expect(records[0]?.vessel).toBe("ISLAND SKY NOBLE CALEDONIA");
    expect(result.ok && result.failures).toHaveLength(1);
  });

  it("does not silently drop the bad row", () => {
    // The heart of ADR-0006. A dropped row stops appearing, `lastSeenAt` stops
    // advancing, and a scraper defect becomes indistinguishable from a genuine
    // absence — in the exact part of the model built never to guess.
    const result = parsed("malformed-row.html");
    const [failure] = (result.ok && result.failures) || [];

    expect(failure?.fragment).toContain("ODYSSEY");
    expect(failure?.fragment.length).toBeGreaterThan(40);
    expect(failure?.expected).toMatch(/arrival/i);
  });

  it("keys the failure where the row got far enough to be keyed", () => {
    const [failure] = (parsed("malformed-row.html") as { failures: { sourceKey?: string }[] })
      .failures;
    // Vessel read, arrival unreadable — so there is no arrival date to key with,
    // and the failure says so by carrying no key rather than a half-made one.
    expect(failure?.sourceKey).toBeUndefined();
  });
});

describe("through the pipeline", () => {
  /**
   * The registered adapter, driven end to end over the bytes SCC really served —
   * only the network is substituted. `fetch` calls the injected client, `parse`
   * reads the real markup, the store mints uids, and the feed is written from
   * the store.
   */
  const runOverFixture = async (name = "schedule.html") => {
    const workspace = mkdtempSync(join(tmpdir(), "scc-"));
    const requested: string[] = [];

    const { outcomes } = await runPipeline({
      sources: [scc],
      db: join(workspace, "calendar.sqlite"),
      feedsDir: join(workspace, "feeds"),
      payloadPath: join(workspace, "calendar.json"),
      now: () => NOW,
      http: {
        get: async (url) => {
          requested.push(url);
          return fixture(name);
        },
      },
    });

    const feeds = join(workspace, "feeds");
    const read = (file: string) => readFileSync(join(feeds, file), "utf8");
    const result = {
      ics: read("port-calls.ics"),
      venueIcs: read("venue-events.ics"),
      hasAllFeed: existsSync(join(feeds, "all.ics")),
      outcomes,
      requested,
    };

    rmSync(workspace, { recursive: true, force: true });
    return result;
  };

  it("reads the schedule through the injected client and reports a clean outcome", async () => {
    const { outcomes, requested } = await runOverFixture();

    expect(requested).toEqual(["https://singaporecruise.com.sg/schedule/cruise/"]);
    expect(outcomes).toEqual([{ source: "scc", ok: true, records: 17, failures: [] }]);
  });

  it("writes every real sailing into port-calls.ics, and nothing into the other feed", async () => {
    const { ics, venueIcs } = await runOverFixture();

    expect(ics).toContain("X-WR-CALNAME:SG Cruise Arrivals");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(17);
    expect(venueIcs.match(/BEGIN:VEVENT/g)).toBeNull();
    expect(venueIcs).not.toContain("ODYSSEY");
  });

  it("offers no all feed", async () => {
    // The unfiltered, duplicate-heavy stream is not a subscription anyone should
    // hold. The everything-view is the web calendar (ADR-0008).
    expect((await runOverFixture()).hasAllFeed).toBe(false);
  });

  it("projects the summary as prose carrying the category, vessel and terminal", async () => {
    const { ics } = await runOverFixture();
    expect(ics).toContain(
      "SUMMARY:Cruise: ODYSSEY VILLA VIE RESIDENCES at Singapore Cruise Centre",
    );
  });

  it("projects the location as the terminal", async () => {
    expect((await runOverFixture()).ics).toContain("LOCATION:Singapore Cruise Centre");
  });

  it("carries the published clock times into the feed", async () => {
    const { ics } = await runOverFixture();
    expect(ics).toContain("DTSTART:20260730T000000Z");
    expect(ics).toContain("DTEND:20260801T110000Z");
  });

  it("writes nothing when the challenge page is served", async () => {
    // Nothing upserted, so no `lastSeenAt` advances and every record this source
    // owns is left exactly as the last real reading left it.
    const { ics, outcomes } = await runOverFixture("imperva-challenge.html");

    expect(outcomes[0]).toMatchObject({ source: "scc", ok: false });
    expect(ics).not.toContain("BEGIN:VEVENT");
  });
});

describe("purity", () => {
  it("returns the same records whatever the clock says", () => {
    // SCC publishes absolute dates in a fixed +08:00 zone, so `now` cannot move
    // the answer and the fixture is safe to age past the ~3-month window.
    const early = parsed("schedule.html", new Date("2020-01-01T00:00:00Z"));
    const late = parsed("schedule.html", new Date("2040-01-01T00:00:00Z"));

    expect(early).toEqual(late);
  });

  it("does not mutate the input", () => {
    const html = fixture("schedule.html");
    scc.parse(html, NOW);
    expect(html).toBe(fixture("schedule.html"));
  });
});
