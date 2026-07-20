import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { instant } from "../src/domain/instant.js";
import type {
  PortCall,
  Scraped,
  SourceId,
  VenueEvent,
} from "../src/domain/types.js";
import { runPipeline } from "../src/pipeline/run.js";
import { openStore } from "../src/store/store.js";
import type { ParseResult, Source } from "../src/sources/types.js";

/**
 * **Seam 1 — the whole pipeline run.** Records go in through a fixture adapter,
 * a `.ics` file and a SQLite database come out, and every assertion reads one
 * of those two. Nothing here reaches for a private helper.
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

let workspace: string;

const dbPath = () => join(workspace, "calendar.sqlite");
const feedsDir = () => join(workspace, "feeds");
const venueFeed = () => readFileSync(join(feedsDir(), "venue-events.ics"), "utf8");

const clockAt = (value: string) => () => new Date(value);

const run = (
  sources: (Source<VenueEvent> | Source<PortCall>)[],
  at: string,
): Promise<unknown> =>
  runPipeline({ sources, db: dbPath(), feedsDir: feedsDir(), now: clockAt(at) });

/** Reads the database back the way a later run — or the operator — would. */
const storedVenueEvents = () => {
  const store = openStore(dbPath());
  try {
    return store.readVenueEvents();
  } finally {
    store.close();
  }
};

const storedPortCalls = () => {
  const store = openStore(dbPath());
  try {
    return store.readPortCalls();
  } finally {
    store.close();
  }
};

const RUN_ONE = "2026-07-01T02:00:00Z";
const RUN_TWO = "2026-07-02T02:00:00Z";

/** The VEVENT bodies, one array of property lines each, unfolded. */
const vevents = (ics: string): string[][] => {
  const unfolded = ics.replace(/\r\n[ \t]/g, "");
  return unfolded
    .split("\r\n")
    .reduce<{ blocks: string[][]; current: string[] | null }>(
      (acc, line) => {
        if (line === "BEGIN:VEVENT") return { ...acc, current: [] };
        if (line === "END:VEVENT" && acc.current) {
          return { blocks: [...acc.blocks, acc.current], current: null };
        }
        if (acc.current) acc.current.push(line);
        return acc;
      },
      { blocks: [], current: null },
    ).blocks;
};

/** `SUMMARY;X=1:value` → `SUMMARY`. */
const propertyName = (line: string): string =>
  line.slice(0, Math.min(...[line.indexOf(":"), line.indexOf(";")].filter((i) => i >= 0))) ||
  line;

const valueOf = (block: string[], name: string): string | undefined => {
  const line = block.find((l) => propertyName(l) === name);
  return line?.slice(line.indexOf(":") + 1);
};

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "sg-calendar-"));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------

describe("the store", () => {
  it("persists both record types, keyed on (source, sourceKey)", async () => {
    await run([venueSourceOf("suntec", [bniVision()]), portCallSourceOf("scc", [odyssey()])], RUN_ONE);

    expect(storedVenueEvents()).toMatchObject([
      { source: "suntec", sourceKey: "bni-vision1472026", name: "BNI Vision" },
    ]);
    expect(storedPortCalls()).toMatchObject([
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

    const stored = storedVenueEvents();
    expect(stored).toHaveLength(2);
    expect(new Set(stored.map((r) => r.uid)).size).toBe(2);
  });

  it("writes no status field of any kind", async () => {
    // Seen-tracking refuses to resolve absence into a status the source never
    // stated. A column would be the first place that refusal leaks.
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);

    const store = openStore(dbPath());
    try {
      expect(store.columnNames().filter((c) => /status|state|deleted|cancelled|active/i.test(c)))
        .toEqual([]);
    } finally {
      store.close();
    }
  });
});

describe("uid durability", () => {
  it("mints a uid once and never recomputes it", async () => {
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);
    const [first] = storedVenueEvents();

    await run([venueSourceOf("suntec", [bniVision()])], RUN_TWO);
    const [second] = storedVenueEvents();

    expect(second?.uid).toBe(first?.uid);
    expect(first?.uid).toBeTruthy();
  });

  it("moves a rescheduled record rather than duplicating it", async () => {
    // The change subscribers most need delivered as an update. Hashing `start`
    // into the uid would deliver it as a second entry beside a stale one.
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);
    const [before] = storedVenueEvents();

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

    const stored = storedVenueEvents();
    expect(stored).toHaveLength(1);
    expect(stored[0]?.uid).toBe(before?.uid);
    expect(stored[0]?.sequence).toBe((before?.sequence ?? 0) + 1);
    expect(stored[0]?.start).toBe("2026-08-17T04:00:00Z");

    expect(vevents(venueFeed())).toHaveLength(1);
  });

  it("keeps the uid when a title is corrected, and bumps sequence", async () => {
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);
    const [before] = storedVenueEvents();

    await run([venueSourceOf("suntec", [bniVision({ name: "BNI Vision 2026" })])], RUN_TWO);

    const [after] = storedVenueEvents();
    expect(after?.uid).toBe(before?.uid);
    expect(after?.sequence).toBe((before?.sequence ?? 0) + 1);
    expect(after?.name).toBe("BNI Vision 2026");
  });

  it("leaves sequence alone when nothing changed", async () => {
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);
    await run([venueSourceOf("suntec", [bniVision()])], RUN_TWO);

    expect(storedVenueEvents()[0]?.sequence).toBe(0);
  });
});

describe("seen-tracking", () => {
  it("fixes firstSeenAt at first sight and advances lastSeenAt on every sighting", async () => {
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);
    await run([venueSourceOf("suntec", [bniVision()])], RUN_TWO);

    expect(storedVenueEvents()[0]).toMatchObject({
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

    const stored = storedVenueEvents();
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ firstSeenAt: RUN_ONE, lastSeenAt: RUN_ONE });
  });

  it("preserves the uid across a disappearance and reappearance", async () => {
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);
    const [minted] = storedVenueEvents();

    await run([venueSourceOf("suntec", [])], RUN_TWO);
    await run([venueSourceOf("suntec", [bniVision()])], "2026-07-03T02:00:00Z");

    expect(storedVenueEvents()[0]).toMatchObject({
      uid: minted?.uid,
      firstSeenAt: RUN_ONE,
      lastSeenAt: "2026-07-03T02:00:00Z",
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

    expect(storedVenueEvents()[0]).toMatchObject({
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

    expect(storedVenueEvents()).toHaveLength(1);
    expect(vevents(venueFeed())).toHaveLength(1);
  });
});

describe("venue-events.ics", () => {
  beforeEach(async () => {
    await run(
      [venueSourceOf("suntec", [bniVision()]), portCallSourceOf("scc", [odyssey()])],
      RUN_ONE,
    );
  });

  it("announces itself as SG Venue Events", () => {
    expect(venueFeed()).toContain("X-WR-CALNAME:SG Venue Events");
  });

  it("carries every VenueEvent and no PortCall", () => {
    const blocks = vevents(venueFeed());
    expect(blocks).toHaveLength(1);
    expect(valueOf(blocks[0]!, "SUMMARY")).toBe("BNI Vision");
    expect(venueFeed()).not.toContain("ODYSSEY");
  });

  it("carries only the seven properties that survive all three clients", () => {
    // CATEGORIES and URL are standard RFC 5545 and each survives on 1 of 3;
    // X- properties are allowlisted per vendor. Conformance is not survival.
    expect(vevents(venueFeed())[0]!.map(propertyName).sort()).toEqual([
      "DESCRIPTION",
      "DTEND",
      "DTSTAMP",
      "DTSTART",
      "LOCATION",
      "SUMMARY",
      "UID",
    ]);
  });

  it("projects location as venue plus hall", () => {
    expect(valueOf(vevents(venueFeed())[0]!, "LOCATION")).toBe(
      "Suntec Convention Centre\\, Level 4\\, Hall 404",
    );
  });

  it("generates a description carrying category and attribution", () => {
    const description = valueOf(vevents(venueFeed())[0]!, "DESCRIPTION") ?? "";
    expect(description).toMatch(/Venue event/i);
    expect(description).toContain("suntec");
  });

  it("serializes times as UTC instants", () => {
    const block = vevents(venueFeed())[0]!;
    expect(valueOf(block, "DTSTART")).toBe("20260717T040000Z");
    // No +1 adjustment: an exclusive DTEND is naturally correct for a timed event.
    expect(valueOf(block, "DTEND")).toBe("20260717T100000Z");
  });

  it("carries a static VTIMEZONE literal and needs no timezone library", () => {
    expect(venueFeed()).toContain("BEGIN:VTIMEZONE");
    expect(venueFeed()).toContain("TZID:Asia/Singapore");
    // Fixed +08:00 with no DST since 1982.
    expect(venueFeed()).not.toContain("DAYLIGHT");
  });

  it("admits no all-day shape and no recurrence", () => {
    expect(venueFeed()).not.toContain("VALUE=DATE");
    expect(venueFeed()).not.toContain("RRULE");
  });

  it("terminates every line with CRLF", () => {
    expect(venueFeed().endsWith("END:VCALENDAR\r\n")).toBe(true);
  });
});

describe("iCal text handling", () => {
  it("escapes the characters that would otherwise end the property value", async () => {
    await run(
      [
        venueSourceOf("suntec", [
          bniVision({ name: "Wine, Spirits; Asia\\Pacific", hall: null }),
        ]),
      ],
      RUN_ONE,
    );

    const block = vevents(venueFeed())[0]!;
    expect(valueOf(block, "SUMMARY")).toBe("Wine\\, Spirits\\; Asia\\\\Pacific");
    // Hall absent — the location is the venue alone, with no dangling separator.
    expect(valueOf(block, "LOCATION")).toBe("Suntec Convention Centre");
  });

  it("folds at 75 octets without splitting a character", async () => {
    // Counted in bytes, not characters: an accented venue name cut mid-codepoint
    // would reach the subscriber as mojibake.
    const longName = `Café Résidence ${"Exhibition ".repeat(12)}2026`;
    await run([venueSourceOf("suntec", [bniVision({ name: longName })])], RUN_ONE);

    const feed = venueFeed();
    const lines = feed.split("\r\n").slice(0, -1);
    expect(lines.some((line) => Buffer.byteLength(line) > 60)).toBe(true);
    expect(lines.every((line) => Buffer.byteLength(line) <= 75)).toBe(true);
    expect(feed).not.toContain("�");
    expect(valueOf(vevents(feed)[0]!, "SUMMARY")).toBe(longName);
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

    expect(storedVenueEvents()).toHaveLength(1);
    expect(vevents(venueFeed()).map((b) => valueOf(b, "SUMMARY"))).toEqual(["Cellar Fiesta"]);
  });
});

describe("idempotence", () => {
  it("produces byte-identical output and identical state on a re-run", async () => {
    // A dropped run must cost freshness and nothing else, so the scrape has to
    // be safe to repeat.
    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);
    const firstBytes = venueFeed();
    const firstState = storedVenueEvents();

    await run([venueSourceOf("suntec", [bniVision()])], RUN_ONE);

    expect(venueFeed()).toBe(firstBytes);
    expect(storedVenueEvents()).toEqual(firstState);
  });

  it("orders entries deterministically regardless of the order sources are read", async () => {
    const later = bniVision({ sourceKey: "later", name: "Later", start: instant("2026-09-01T04:00:00Z"), end: instant("2026-09-01T10:00:00Z") });

    await run([venueSourceOf("suntec", [bniVision(), later])], RUN_ONE);
    const forwards = vevents(venueFeed()).map((b) => valueOf(b, "SUMMARY"));

    await run([venueSourceOf("suntec", [later, bniVision()])], RUN_ONE);
    const backwards = vevents(venueFeed()).map((b) => valueOf(b, "SUMMARY"));

    expect(forwards).toEqual(["BNI Vision", "Later"]);
    expect(backwards).toEqual(forwards);
  });
});
