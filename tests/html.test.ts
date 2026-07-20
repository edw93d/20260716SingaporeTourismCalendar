import { describe, expect, it } from "vitest";
import { decodeEntities, textOf } from "../src/sources/html.js";

/**
 * The adapters' only shared code (ADR-0005, Amendment 1), and until this file
 * existed the **named**-entity path had no coverage in either adapter: Suntec
 * reads its names from the gcal URL parameter, where `decodeURIComponent` turns
 * `%26` into `&` and a real non-breaking space into whitespace the collapse
 * already handles, so the table is never consulted. Replacing the whole named
 * lookup with `return whole` left all 164 tests green.
 *
 * These are unit tests rather than fixture tests on purpose — this module holds
 * no opinion about any source, so there is no page whose bytes could exercise it
 * more honestly than a direct call.
 */

describe("decodeEntities", () => {
  it("decodes the named entities the adapters actually meet", () => {
    expect(decodeEntities("Congress &amp; Meeting")).toBe("Congress & Meeting");
    expect(decodeEntities("&lt;tag&gt;")).toBe("<tag>");
    expect(decodeEntities("&quot;quoted&quot;")).toBe('"quoted"');
    expect(decodeEntities("it&apos;s")).toBe("it's");
    expect(decodeEntities("Asia&ndash;Pacific")).toBe("Asia–Pacific");
    expect(decodeEntities("wait&hellip;")).toBe("wait…");
  });

  it("is case-insensitive on the entity name", () => {
    // `&AMP;` is rarer than `&amp;` but legal, and the lookup lowercases for it.
    expect(decodeEntities("A &AMP; B")).toBe("A & B");
  });

  it("decodes decimal and hex numeric references", () => {
    expect(decodeEntities("&#38;")).toBe("&");
    expect(decodeEntities("&#x26;")).toBe("&");
    expect(decodeEntities("&#X26;")).toBe("&");
    // Astral plane — `String.fromCodePoint`, not `fromCharCode`.
    expect(decodeEntities("&#x1F6A2;")).toBe("🚢");
  });

  it("returns an unrecognised reference whole rather than dropping it", () => {
    // A source that starts publishing `&eacute;` should surface as a visibly odd
    // string an operator can report, not as a silently shortened one.
    expect(decodeEntities("caf&eacute;")).toBe("caf&eacute;");
    expect(decodeEntities("&#xZZ;")).toBe("&#xZZ;");
  });

  it("leaves a bare ampersand alone", () => {
    expect(decodeEntities("Tom & Jerry")).toBe("Tom & Jerry");
  });
});

describe("textOf", () => {
  it("strips tags, decodes entities, and collapses whitespace", () => {
    expect(textOf("<td>  ODYSSEY &amp;\n  VILLA VIE  </td>")).toBe("ODYSSEY & VILLA VIE");
  });

  it("replaces a tag with a space rather than deleting it", () => {
    // `<td>a</td><td>b</td>` must read as two words. Deleting tags would weld
    // adjacent cells into one token.
    expect(textOf("<td>a</td><td>b</td>")).toBe("a b");
  });

  it("collapses a decoded &nbsp; like any other whitespace", () => {
    expect(textOf("Cellar Fiesta 2026&nbsp;")).toBe("Cellar Fiesta 2026");
  });

  it("drops an img tag entirely, attributes and all", () => {
    // SCC's rows lead with the cruise line's logo; a naive read welds that URL
    // to the front of the vessel and from there into `sourceKey`, permanently.
    expect(textOf('<img src="https://x.test/wp-content/logo.png">ODYSSEY')).toBe("ODYSSEY");
  });
});
