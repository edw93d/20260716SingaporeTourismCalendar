import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Scraped, VenueEvent } from "../src/domain/types.js";
import { runPipeline } from "../src/pipeline/run.js";
import { suntec } from "../src/sources/suntec.js";
import type { FetchDeps, ParseResult } from "../src/sources/types.js";

/**
 * **Seam 2 — pure `parse` over saved fixture HTML, with an injected clock.**
 *
 * No network. Everything here reads bytes that Suntec really served on
 * 2026-07-20 (see `tests/fixtures/suntec/`), or a minimal edit of them made to
 * stage one failure mode. The fixtures are real rather than synthetic because
 * the whole risk this adapter carries is *what the page actually looks like* —
 * a hand-written fixture would assert our imagination and pass while the real
 * markup moved on.
 *
 * The last block runs those same bytes through the whole pipeline, because
 * "true clock times reach the feed" is a claim about the chain and not about
 * `parse`: every intermediate step could be right and the `.ics` still say
 * midnight.
 */

const fixture = (name: string): string =>
  readFileSync(fileURLToPath(new URL(`./fixtures/suntec/${name}`, import.meta.url)), "utf8");

/** Any clock. Suntec publishes absolute UTC instants, so none of these depend on it. */
const NOW = new Date("2026-07-20T02:00:00Z");

const parsed = (name: string, now: Date = NOW): ParseResult<Scraped<VenueEvent>> =>
  suntec.parse(fixture(name), now);

/** Narrows to the ok arm and fails loudly rather than silently skipping assertions. */
const recordsOf = (result: ParseResult<Scraped<VenueEvent>>): Scraped<VenueEvent>[] => {
  if (!result.ok) throw new Error(`expected ok, got: ${result.reason}`);
  return result.records;
};

const byKey = (result: ParseResult<Scraped<VenueEvent>>, key: string): Scraped<VenueEvent> => {
  const found = recordsOf(result).find((r) => r.sourceKey === key);
  if (!found) throw new Error(`no record keyed ${key}`);
  return found;
};

// ---------------------------------------------------------------------------

describe("the adapter's shape", () => {
  it("identifies itself as suntec", () => {
    expect(suntec.key).toBe("suntec");
  });

  it("is registered in the explicit array", async () => {
    const { sources } = await import("../src/sources/registry.js");
    expect(sources).toContain(suntec);
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

    await suntec.fetch(deps);

    expect(urls).toEqual(["https://www.suntecsingapore.com/visit-events"]);
    // Server-rendered and undefended. Headless must not become the default
    // execution model, so this adapter does not even receive the option.
    expect(deps).not.toHaveProperty("browser");
  });

  it("never reaches for the robots.txt-disallowed export endpoints", async () => {
    // `?format=ical` and `?format=json` are disallowed for every agent, and each
    // row links its own. Comments are stripped before the check because this
    // module legitimately *explains* why those endpoints are not used.
    const code = readFileSync(
      fileURLToPath(new URL("../src/sources/suntec.ts", import.meta.url)),
      "utf8",
    )
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

    expect(code).not.toContain("format=ical");
    expect(code).not.toContain("format=json");
  });
});

describe("parsing the real listing", () => {
  it("reads every row the fixture carries, with no failures", () => {
    const result = parsed("listing.html");
    expect(recordsOf(result)).toHaveLength(6);
    expect(result.ok && result.failures).toEqual([]);
  });

  it("extracts timing from the Google Calendar export link, as UTC instants", () => {
    expect(byKey(parsed("listing.html"), "cellar-fiesta-2026")).toMatchObject({
      start: "2026-07-17T04:00:00Z",
      end: "2026-07-18T14:00:00Z",
    });
  });

  it("keeps a true clock time, not a midnight the date-only attribute would have given", () => {
    // The single assertion this adapter exists for: 04:00Z is 12:00 SGT, and it is
    // reachable only from the gcal link.
    const record = byKey(parsed("listing.html"), "cellar-fiesta-2026");
    expect(record.start).not.toMatch(/T00:00:00Z$/);
    expect(record.end).not.toMatch(/T00:00:00Z$/);
  });

  it("carries a multi-day span across its real end date", () => {
    expect(byKey(parsed("listing.html"), "wellness-fiesta-by-guardian-health-and-beauty-1"))
      .toMatchObject({
        start: "2026-07-17T02:00:00Z",
        end: "2026-07-19T14:00:00Z",
      });
  });

  it("takes the name as published, decoding entities and trimming", () => {
    const names = recordsOf(parsed("listing.html")).map((r) => r.name);
    expect(names).toContain(
      "8th Asia Pacific Glaucoma Congress & 35th SNEC Anniversary International Meeting 2026 - Exhibition",
    );
    // The real row's title ends in a literal `&nbsp;`.
    expect(names).toContain("Cellar Fiesta 2026");
    expect(names.every((n) => n === n.trim() && n.length > 0)).toBe(true);
  });

  it("names the venue as a constant, not as scraped from the row", () => {
    expect(
      recordsOf(parsed("listing.html")).every((r) => r.venue === "Suntec Convention Centre"),
    ).toBe(true);
  });

  it("extracts the hall from the gcal location, without the street address", () => {
    expect(byKey(parsed("listing.html"), "cellar-fiesta-2026").hall).toBe("Level 4, Hall 404");
    expect(
      byKey(parsed("listing.html"), "wellness-fiesta-by-guardian-health-and-beauty-1").hall,
    ).toBe("Level 4, Hall 401-402");
  });

  it("reports a null hall when the row publishes only the building", () => {
    // Nullable, never a fabricated default: the source published no hall.
    expect(byKey(parsed("listing.html"), "cws-thanksgiving-18-july-2026").hall).toBeNull();
  });

  it("still recognises the street address after a copy edit, and keeps it out of the hall", () => {
    // The address is filtered by pattern, not by equality against the exact
    // published literal. Under equality this drift — a doubled space, a lowercase
    // street, a renamed complex — leaks `1  raffles Boulevard Suntec Towers` into
    // `hall`, and from there into every LOCATION line in the feed.
    const drifted = fixture("listing.html").replace(
      /1%20Raffles%20Boulevard%20Suntec%20City/g,
      "1%20%20raffles%20Boulevard%20Suntec%20Towers",
    );

    expect(byKey(suntec.parse(drifted, NOW), "cellar-fiesta-2026").hall).toBe("Level 4, Hall 404");
    expect(byKey(suntec.parse(drifted, NOW), "cws-thanksgiving-18-july-2026").hall).toBeNull();
  });

  it("reads timing from the gcal link only, not from another link in the same row", () => {
    // The row already carries a second export link. Today it sits *after* the
    // gcal link and carries no parameters, so a whole-row search happens to be
    // right — by luck of ordering, not by construction. This stages the two
    // template changes that would end that luck at once: the ical link gains
    // dates=/location= and is emitted first. A whole-row search reads 1999.
    const decoy =
      '<a href="/visit-events/cellar-fiesta-2026?format=ical' +
      "&dates=19990101T000000Z/19990101T010000Z" +
      '&location=Decoy%20Hall%2C%20Singapore" class="eventlist-meta-export-ical"></a>';

    const gcalLink = fixture("listing.html").match(
      /<a[^>]*text=Cellar[^>]*class="eventlist-meta-export-google">/,
    )?.[0];
    if (!gcalLink) throw new Error("fixture no longer has the gcal link this test stages against");

    const decoyed = fixture("listing.html").replace(gcalLink, decoy + gcalLink);

    const record = byKey(suntec.parse(decoyed, NOW), "cellar-fiesta-2026");
    expect(record.start).toBe("2026-07-17T04:00:00Z");
    expect(record.hall).toBe("Level 4, Hall 404");
  });

  it("labels every record with its own source", () => {
    expect(recordsOf(parsed("listing.html")).every((r) => r.source === "suntec")).toBe(true);
  });
});

describe("sourceKey", () => {
  it("is the slug from the detail URL", () => {
    expect(recordsOf(parsed("listing.html")).map((r) => r.sourceKey)).toContain(
      "bni-vision2172026",
    );
  });

  it("is unique across the listing", () => {
    const keys = recordsOf(parsed("listing.html")).map((r) => r.sourceKey);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("carries no query string, even though the row's other links have one", () => {
    // The row also links `<slug>?format=ical`. Reading the slug off that link
    // would drag a disallowed endpoint's query into the identity of the record.
    expect(recordsOf(parsed("listing.html")).every((r) => !r.sourceKey.includes("?"))).toBe(true);
  });
});

describe("facts-only extraction", () => {
  it("mints no uid and no memory fields", () => {
    // `Scraped<T>` makes this unwritable, but the fixture rows are the place the
    // temptation would arrive, so it is asserted on real output too.
    for (const record of recordsOf(parsed("listing.html"))) {
      expect(record).not.toHaveProperty("uid");
      expect(record).not.toHaveProperty("sequence");
      expect(record).not.toHaveProperty("firstSeenAt");
      expect(record).not.toHaveProperty("lastSeenAt");
    }
  });

  it("scrapes no description, though the fixture rows all carry one", () => {
    // ~8% populated, and the single weakest thing we would have held legally.
    expect(fixture("listing.html")).toContain("eventlist-description");

    const keys = new Set(recordsOf(parsed("listing.html")).flatMap((r) => Object.keys(r)));
    expect(keys).toEqual(
      new Set(["source", "sourceKey", "name", "start", "end", "venue", "hall"]),
    );
  });

  it("lets no prose from the listing reach any extracted value", () => {
    const values = recordsOf(parsed("listing.html")).flatMap((r) => Object.values(r));
    expect(values.some((v) => typeof v === "string" && v.includes("free sampli"))).toBe(false);
  });
});

describe("the `<time datetime>` trap", () => {
  it("takes the gcal interval when the visible times disagree with it", () => {
    // Asserted against, not merely avoided. On the real page the two agree on the
    // date and the attribute is date-only, so a wrong parser passes silently; this
    // fixture makes them disagree so the wrong answer is visible.
    const fragment = fixture("trap-disagreeing-times.html");
    expect(fragment).toContain('datetime="2026-01-02"');
    expect(fragment).toContain(">09:15<");
    expect(fragment).toContain("dates=20260717T040000Z/20260718T140000Z");

    expect(recordsOf(parsed("trap-disagreeing-times.html"))[0]).toMatchObject({
      start: "2026-07-17T04:00:00Z",
      end: "2026-07-18T14:00:00Z",
    });
  });

  it("reads neither the datetime attribute nor the visible clock text", () => {
    const record = recordsOf(parsed("trap-disagreeing-times.html"))[0]!;
    expect(record.start).not.toContain("2026-01-02");
    expect(record.end).not.toContain("2026-01-03");
    // 09:15 SGT would be 01:15Z; 19:45 SGT would be 11:45Z. Neither appears.
    expect([record.start, record.end]).not.toContain("2026-01-02T01:15:00Z");
    expect([record.start, record.end]).not.toContain("2026-01-03T11:45:00Z");
  });
});

describe("the three parse outcomes", () => {
  it("returns ok with no records when the anchor is present and empty", () => {
    // A genuinely empty source is a fact, not a failure.
    expect(parsed("empty-listing.html")).toEqual({ ok: true, records: [], failures: [] });
  });

  it("returns not-ok with a reason when the anchor is absent", () => {
    const result = parsed("anchor-absent.html");
    expect(result.ok).toBe(false);
    expect(!result.ok && result.reason).toMatch(/eventlist/);
  });

  it("checks the anchor before examining any row", () => {
    // A document with rows but no listing container is not our document. Reading
    // the rows anyway would launder a redesign into a partial success.
    const rowsWithoutAnchor = fixture("listing.html").replace(
      /<div class="eventlist eventlist--upcoming">/,
      '<div class="something-else">',
    );
    expect(suntec.parse(rowsWithoutAnchor, NOW).ok).toBe(false);
  });

  it("returns the good records plus a failure when one row is malformed", () => {
    const result = parsed("malformed-row.html");
    const records = recordsOf(result);

    expect(records).toHaveLength(1);
    expect(records[0]?.sourceKey).toBe("bni-hq2072026");
    expect(result.ok && result.failures).toHaveLength(1);
  });

  it("does not silently drop the bad row", () => {
    // The heart of ADR-0006. A dropped row stops appearing, `lastSeenAt` stops
    // advancing, and it becomes indistinguishable from a genuine absence — a
    // scraper defect laundered into a domain observation.
    const result = parsed("malformed-row.html");
    const [failure] = (result.ok && result.failures) || [];

    expect(failure?.sourceKey).toBe("bni-vision2172026");
    expect(failure?.fragment).toContain("bni-vision2172026");
    expect(failure?.expected).toMatch(/google calendar|gcal|dates/i);
  });

  it("carries enough of the failing fragment to debug without re-scraping", () => {
    const [failure] = (parsed("malformed-row.html") as { failures: unknown[] }).failures as {
      fragment: string;
    }[];
    expect(failure!.fragment.length).toBeGreaterThan(40);
  });
});

describe("through the pipeline", () => {
  /**
   * The registered adapter, driven end to end over the bytes Suntec really
   * served — only the network is substituted. Everything else is the production
   * path: `fetch` calls the injected client, `parse` reads the real markup, the
   * store mints uids, and the feed is written from the store.
   */
  const runOverFixture = async () => {
    const workspace = mkdtempSync(join(tmpdir(), "suntec-"));
    const requested: string[] = [];

    const { outcomes } = await runPipeline({
      sources: [suntec],
      db: join(workspace, "calendar.sqlite"),
      feedsDir: join(workspace, "feeds"),
      payloadPath: join(workspace, "calendar.json"),
      now: () => NOW,
      http: {
        get: async (url) => {
          requested.push(url);
          return fixture("listing.html");
        },
      },
    });

    const ics = readFileSync(join(workspace, "feeds", "venue-events.ics"), "utf8");
    rmSync(workspace, { recursive: true, force: true });
    return { ics, outcomes, requested };
  };

  it("reads the listing through the injected client and reports a clean outcome", async () => {
    const { outcomes, requested } = await runOverFixture();

    expect(requested).toEqual(["https://www.suntecsingapore.com/visit-events"]);
    expect(outcomes).toEqual([
      { source: "suntec", ok: true, records: 6, failures: [] },
    ]);
  });

  it("writes real Suntec entries into venue-events.ics", async () => {
    const { ics } = await runOverFixture();

    expect(ics).toContain("X-WR-CALNAME:SG Venue Events");
    expect(ics).toContain("SUMMARY:Cellar Fiesta 2026");
    expect(ics).toContain("LOCATION:Suntec Convention Centre\\, Level 4\\, Hall 404");
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(6);
  });

  it("carries true clock times into the feed, not midnight", async () => {
    // The end of the chain the gcal decision exists for. `20260717T040000Z` is
    // 12:00 SGT; the date-only attribute would have put `20260717T000000Z` here
    // and every one of these assertions would still have looked reasonable.
    const { ics } = await runOverFixture();

    expect(ics).toContain("DTSTART:20260717T040000Z");
    expect(ics).toContain("DTEND:20260718T140000Z");

    const starts = [...ics.matchAll(/DTSTART:(\d{8}T\d{6})Z/g)].map((m) => m[1]!);
    expect(starts).toHaveLength(6);
    expect(starts.every((s) => s.endsWith("000000"))).toBe(false);
  });

  it("puts no scraped prose in the feed", async () => {
    const { ics } = await runOverFixture();
    expect(ics).not.toContain("free sampli");
    expect(ics).not.toContain("largest alcohol festival");
  });
});

describe("purity", () => {
  it("returns the same records whatever the clock says", () => {
    // Suntec publishes absolute UTC instants, so `now` cannot move the answer.
    // The fixture is therefore safe to age past the ~3-month publishing window.
    const early = parsed("listing.html", new Date("2020-01-01T00:00:00Z"));
    const late = parsed("listing.html", new Date("2040-01-01T00:00:00Z"));

    expect(early).toEqual(late);
  });

  it("does not mutate the input", () => {
    const html = fixture("listing.html");
    suntec.parse(html, NOW);
    expect(html).toBe(fixture("listing.html"));
  });
});
