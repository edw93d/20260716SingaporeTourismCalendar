import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sources } from "../src/sources/registry.js";

/**
 * Guards for decisions that are enforced by convention everywhere else, and so
 * would rot silently. Each one corresponds to a standing constraint that a
 * future contributor could breach without any other test going red.
 */

const SRC = fileURLToPath(new URL("../src", import.meta.url));

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return entry.name.endsWith(".ts") ? [path] : [];
  });

/**
 * Strips comments, string literals and regex literals, leaving only identifiers.
 *
 * All three exclusions are load-bearing. Comments legitimately *discuss* the
 * banned term — this file does, and so does the domain model. String and regex
 * literals hold **markup and URLs we do not control**: Suntec's structural
 * anchor is `article.eventlist-event`, so a guard that read their contents would
 * forbid the very selector the adapter is required to match on.
 *
 * Done as a **single left-to-right scan**, not a chain of independent replaces.
 * A chain has to decide what a delimiter means without knowing what it is inside
 * of, and every ordering of it is wrong somewhere real:
 *
 * - strip comments first, and `"https://host/visit-events"` loses its tail to
 *   the line-comment rule, leaving an unterminated quote that swallows the rest
 *   of the file;
 * - strip strings first, and a comment containing an apostrophe pairs with the
 *   next one, doing the same;
 * - strip either before regexes, and `/class="[^"]*eventlist"/` has its own
 *   quotes paired across the pattern, leaving its middle behind as code.
 *
 * Each of those was reached by real source in this repo, so the scanner is the
 * cheap version, not the thorough one.
 */
const identifiersOnly = (code: string): string => {
  /** A `/` opens a regex only in value position; after a value it is division. */
  const REGEX_MAY_FOLLOW = /(?:[=(,:;[!&|?{}+\-*%~^]|\b(?:return|typeof|case|in|of|do|else))\s*$/;

  let out = "";
  let i = 0;

  while (i < code.length) {
    const rest = code.slice(i);

    if (rest.startsWith("//")) {
      i = code.indexOf("\n", i);
      if (i === -1) break;
      continue;
    }
    if (rest.startsWith("/*")) {
      const close = code.indexOf("*/", i + 2);
      i = close === -1 ? code.length : close + 2;
      continue;
    }

    const char = code[i]!;

    if (char === '"' || char === "'" || char === "`") {
      i += 1;
      while (i < code.length && code[i] !== char) i += code[i] === "\\" ? 2 : 1;
      i += 1;
      out += char + char;
      continue;
    }

    if (char === "/" && REGEX_MAY_FOLLOW.test(out)) {
      i += 1;
      let inClass = false;
      while (i < code.length) {
        const c = code[i]!;
        if (c === "\\") i += 2;
        else if (c === "[") (inClass = true), (i += 1);
        else if (c === "]") (inClass = false), (i += 1);
        else if (c === "/" && !inClass) break;
        else if (c === "\n") break;
        else i += 1;
      }
      i += 1;
      while (i < code.length && /[gimsuy]/.test(code[i]!)) i += 1;
      out += "/(?:)/";
      continue;
    }

    out += char;
    i += 1;
  }

  return out;
};

const files = sourceFiles(SRC).map((path) => ({
  path: path.slice(SRC.length + 1),
  code: identifiersOnly(readFileSync(path, "utf8")),
}));

describe("the source tree", () => {
  it("has files to check", () => {
    // Guards the guards: a broken glob would make every test below vacuous.
    expect(files.length).toBeGreaterThan(0);
  });

  it("never uses 'event' as a bare term, in any casing", () => {
    // CONTEXT.md § Event. It was doing two incompatible jobs, and forcing them
    // into one schema is what produced a description field that meant nothing.
    // Case-insensitive because `const event = …` in an adapter is the likelier
    // drift than a bare `Event` type. \b does not match inside VenueEvent or
    // addEventListener, so neither is caught.
    const offenders = files
      .filter(({ code }) => /\bevents?\b/i.test(code))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("tolerates the banned term inside a selector string", () => {
    // Suntec's structural anchor (ADR-0006) is `article.eventlist-event`. The
    // guard above must not forbid it, or it blocks the adapter that needs it.
    const suntecAnchor = 'const ANCHOR = "article.eventlist-event";';
    expect(/\bevents?\b/i.test(identifiersOnly(suntecAnchor))).toBe(false);
  });

  it("tolerates the banned term inside a selector regex, quotes and all", () => {
    // The shape the Suntec adapter actually uses. A guard that stripped strings
    // before regexes would pair the pattern's own quotes and leave its middle
    // behind, failing the one adapter it was written to permit.
    const rowPattern = 'const ROW = /<article[^>]*class="[^"]*eventlist-event"/;';
    expect(/\bevents?\b/i.test(identifiersOnly(rowPattern))).toBe(false);
  });

  it("tolerates a URL whose path carries the banned term", () => {
    // The Suntec listing lives at `/visit-events`. Read as a line comment — the
    // obvious ordering — the `//` in `https://` truncates the literal and the
    // unterminated quote swallows the rest of the file.
    const url = 'const LISTING = "https://www.suntecsingapore.com/visit-events";';
    expect(/\bevents?\b/i.test(identifiersOnly(url))).toBe(false);
    // Everything after it must still be visible to the guard.
    expect(identifiersOnly(`${url}\nconst after = 1;`)).toContain("after");
  });

  it("still catches the banned term in an identifier beside a literal", () => {
    // Guards the guard: an over-broad stripper would silently permit everything.
    expect(identifiersOnly('const events = /class="eventlist"/;')).toMatch(/\bevents\b/);
    expect(identifiersOnly('const url = "/visit-events"; let event = 1;')).toMatch(/\bevent\b/);
  });

  it("reads no environment variables", () => {
    // v1 has zero credentials end to end — everything authenticates with
    // GITHUB_TOKEN inside the workflow and nothing else. A process.env read is
    // the first step of walking that property back.
    const offenders = files
      .filter(({ code }) => /process\.env/.test(code))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });

  it("loads no configuration file", () => {
    // Selectors and URLs are constants in their adapter module. A config system
    // is foreclosed by the standing constraint that extraction is code.
    const offenders = files
      .filter(({ code }) => /\b(dotenv|readFileSync|readFile)\b.*config|config\.(json|ya?ml|toml)/i.test(code))
      .map(({ path }) => path);

    expect(offenders).toEqual([]);
  });
});

describe("the source registry", () => {
  it("lists exactly the sources that feed this calendar", () => {
    // One file answers "what feeds this?". Adding a source touches two files —
    // the module and this array — and that is the point, not overhead.
    expect(sources.map((source) => source.key)).toEqual(["suntec"]);
  });

  it("is an array, not a discovered map", () => {
    expect(Array.isArray(sources)).toBe(true);
  });

  it("carries no enabled flag on any source", () => {
    // Disabling a source is a one-line revertable diff. A flag would reintroduce
    // the config system through the side door — see ADR-0005.
    for (const source of sources) {
      expect(source).not.toHaveProperty("enabled");
      expect(Object.keys(source).sort()).toEqual(["fetch", "key", "parse"]);
    }
  });
});

describe("dependencies", () => {
  const pkg = JSON.parse(
    readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
  ) as {
    license?: string;
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };

  it("pulls in no configuration or secrets library", () => {
    const all = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    const banned = all.filter((name) =>
      /^(dotenv|convict|nconf|config|@dotenvx)/.test(name),
    );

    expect(banned).toEqual([]);
  });

  it("declares AGPL-3.0-or-later", () => {
    // Load-bearing, not administrative: it is what makes the calendar component
    // free, and the network clause is part of what forces the repo public.
    expect(pkg.license).toBe("AGPL-3.0-or-later");
  });
});
