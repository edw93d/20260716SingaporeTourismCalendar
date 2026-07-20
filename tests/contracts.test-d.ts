import { assertType, describe, expectTypeOf, it } from "vitest";
import type { Instant } from "../src/domain/instant.js";
import type {
  CalendarEntry,
  PortCall,
  Scraped,
  VenueEvent,
} from "../src/domain/types.js";
import type {
  BrowserSession,
  FetchDeps,
  ParseResult,
  Source,
} from "../src/sources/types.js";

/**
 * These contracts have no runtime surface — they are enforced by the compiler
 * or not at all, so they are asserted at the type level.
 */

describe("Scraped<T> — the adapter observes, the core remembers", () => {
  it("excludes the four fields a parser structurally cannot know", () => {
    expectTypeOf<Scraped<VenueEvent>>().not.toHaveProperty("uid");
    expectTypeOf<Scraped<VenueEvent>>().not.toHaveProperty("sequence");
    expectTypeOf<Scraped<VenueEvent>>().not.toHaveProperty("firstSeenAt");
    expectTypeOf<Scraped<VenueEvent>>().not.toHaveProperty("lastSeenAt");
  });

  it("excludes them from PortCall too", () => {
    expectTypeOf<Scraped<PortCall>>().not.toHaveProperty("uid");
    expectTypeOf<Scraped<PortCall>>().not.toHaveProperty("sequence");
  });

  it("keeps everything the parser genuinely observes", () => {
    expectTypeOf<Scraped<VenueEvent>>().toHaveProperty("name");
    expectTypeOf<Scraped<VenueEvent>>().toHaveProperty("start");
    expectTypeOf<Scraped<VenueEvent>>().toHaveProperty("venue");
    expectTypeOf<Scraped<VenueEvent>>().toHaveProperty("hall");
    // sourceKey IS the adapter's to compute — ADR-0004.
    expectTypeOf<Scraped<VenueEvent>>().toHaveProperty("sourceKey");
  });

  it("makes minting a uid in a parser unwritable", () => {
    const parsed: Scraped<VenueEvent> = {
      source: "suntec",
      sourceKey: "bni-vision1472026",
      name: "BNI Vision",
      start: "2026-07-17T04:00:00Z" as Instant,
      end: "2026-07-17T10:00:00Z" as Instant,
      venue: "Suntec Convention Centre",
      hall: "Level 4, Hall 404",
    };

    // @ts-expect-error — a parser has no yesterday; uid is durable state the
    // core looks up by (source, sourceKey), never something the page can tell us.
    parsed.uid = "anything";
  });
});

describe("the two types stay two types", () => {
  it("gives PortCall no name — a port call has none, and a unified schema would fabricate one", () => {
    expectTypeOf<PortCall>().not.toHaveProperty("name");
  });

  it("gives neither type a scraped description", () => {
    // Facts-only extraction, zero exceptions. The iCal DESCRIPTION property
    // survives only as prose we generate, which lives on CalendarEntry.
    expectTypeOf<VenueEvent>().not.toHaveProperty("description");
    expectTypeOf<PortCall>().not.toHaveProperty("description");
    expectTypeOf<CalendarEntry>().toHaveProperty("description");
  });

  it("keeps vessel unsplit — there is no ship/line pair", () => {
    expectTypeOf<PortCall>().toHaveProperty("vessel");
    expectTypeOf<PortCall>().not.toHaveProperty("line");
    expectTypeOf<PortCall>().not.toHaveProperty("ship");
  });
});

describe("timing admits no date-only shape", () => {
  it("types the four timing fields as Instant, not string", () => {
    expectTypeOf<VenueEvent["start"]>().toEqualTypeOf<Instant>();
    expectTypeOf<VenueEvent["end"]>().toEqualTypeOf<Instant>();
    expectTypeOf<PortCall["arrival"]>().toEqualTypeOf<Instant>();
    expectTypeOf<PortCall["departure"]>().toEqualTypeOf<Instant>();
  });

  it("refuses a bare string, so a date-only value cannot slip in unvalidated", () => {
    // @ts-expect-error — must go through instant(), which rejects '2026-07-17'.
    const start: Instant = "2026-07-17";
    void start;
  });
});

describe("FetchDeps scopes headless by construction", () => {
  it("makes browser optional, so an adapter that does not ask cannot acquire one", () => {
    // Omitting `browser` must compile. If it were required this errors, which
    // is the whole guard — Suntec and SCC construct deps without a browser.
    const withoutBrowser: FetchDeps = {
      http: { get: async () => "" },
      now: () => new Date(),
    };
    assertType<FetchDeps>(withoutBrowser);

    // Optional, and specifically a BrowserSession when present — not `any`,
    // which would let an adapter smuggle in its own client.
    expectTypeOf<FetchDeps["browser"]>().toEqualTypeOf<
      BrowserSession | undefined
    >();
  });

  it("offers no route to the network besides the injected client", () => {
    expectTypeOf<FetchDeps>().toHaveProperty("http");
    expectTypeOf<FetchDeps>().not.toHaveProperty("fetch");
  });
});

describe("ParseResult", () => {
  it("carries records and failures together on the ok arm", () => {
    const result: ParseResult<Scraped<PortCall>> = {
      ok: true,
      records: [],
      failures: [{ fragment: "<tr/>", expected: "an arrival date" }],
    };
    if (result.ok) {
      expectTypeOf(result.records).toEqualTypeOf<Scraped<PortCall>[]>();
      expectTypeOf(result.failures).toBeArray();
    }
  });

  it("has no records on the not-ok arm — anchor absent means nothing was read", () => {
    const result: ParseResult<Scraped<PortCall>> = {
      ok: false,
      reason: "schedule table absent — likely an Imperva challenge page",
    };
    if (!result.ok) {
      expectTypeOf(result).not.toHaveProperty("records");
    }
  });
});

describe("Source", () => {
  it("returns Scraped<T> from parse, never a domain type", () => {
    expectTypeOf<Source<VenueEvent>["parse"]>().returns.toEqualTypeOf<
      ParseResult<Scraped<VenueEvent>>
    >();
  });

  it("keeps Raw opaque, so callers cannot tell how the bytes were obtained", () => {
    expectTypeOf<Source<VenueEvent>>().toHaveProperty("fetch");
    expectTypeOf<Source<VenueEvent, string>["fetch"]>().returns.resolves.toEqualTypeOf<string>();
  });
});
