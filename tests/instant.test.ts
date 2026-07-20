import { describe, expect, it } from "vitest";
import { instant, instantFromDate, toDate } from "../src/domain/instant.js";

describe("instant", () => {
  it("accepts a UTC instant and canonicalises it to second precision", () => {
    expect(instant("2026-07-17T04:00:00Z")).toBe("2026-07-17T04:00:00Z");
  });

  it("converts an explicit offset to UTC losslessly", () => {
    // Asia/Singapore is a fixed +08:00 with no DST since 1982, so this needs
    // no timezone library — see CONTEXT.md § Timing.
    expect(instant("2026-07-17T12:00:00+08:00")).toBe("2026-07-17T04:00:00Z");
  });

  it("drops sub-second precision, which iCal cannot carry anyway", () => {
    expect(instant("2026-07-17T04:00:00.512Z")).toBe("2026-07-17T04:00:00Z");
  });

  describe("rejects everything that is not an instant", () => {
    // This is the point of the type. ADR-0003 retired the all-day shape along
    // with Ticketmaster; a date-only value must be unrepresentable, not merely
    // discouraged, so that no serializer ever has to guess a clock time.
    it("rejects a date-only value", () => {
      expect(() => instant("2026-07-17")).toThrow(/date-only/i);
    });

    it("rejects a naive date-time with no offset", () => {
      // Ambiguous: the caller must state the offset it observed.
      expect(() => instant("2026-07-17T12:00:00")).toThrow(/offset/i);
    });

    it("rejects a calendar date that does not exist", () => {
      expect(() => instant("2026-02-30T04:00:00Z")).toThrow(/not a valid/i);
    });

    it("rejects a value that is not a date at all", () => {
      expect(() => instant("next tuesday")).toThrow(/not a valid/i);
    });

    it("rejects an empty value", () => {
      expect(() => instant("")).toThrow(/not a valid/i);
    });
  });

  it("round-trips through a Date", () => {
    const value = instant("2026-07-17T04:00:00Z");
    expect(instantFromDate(toDate(value))).toBe(value);
  });

  it("orders lexicographically, so the cohort query needs no parsing", () => {
    // Canonical UTC strings sort chronologically as plain text. ADR-0007's
    // future-dated cohort leans on this.
    const earlier = instant("2026-07-17T04:00:00Z");
    const later = instant("2026-07-17T14:00:00Z");
    expect([later, earlier].sort()).toEqual([earlier, later]);
  });

  it("rejects an invalid Date rather than emitting a broken instant", () => {
    expect(() => instantFromDate(new Date("nope"))).toThrow(/not a valid/i);
  });
});
