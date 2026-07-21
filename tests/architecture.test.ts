import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sources } from "../src/sources/registry.js";
import { identifiersOnly } from "./support/identifiers-only.js";

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

const files = sourceFiles(SRC).map((path) => {
  const raw = readFileSync(path, "utf8");
  return {
    path: path.slice(SRC.length + 1),
    code: identifiersOnly(raw),
    // The verbatim bytes, for the few guards that must read a string literal —
    // `identifiersOnly` strips those, so an `import … from "playwright"` is
    // invisible to `code` and has to be matched against `raw` instead.
    raw,
  };
});

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
    // Suntec's structural anchor (ADR-0006) is `div.eventlist`, and its rows are
    // `article.eventlist-event`. Both selector strings carry the banned term, and
    // the guard above must forbid neither, or it blocks the adapter that needs them.
    const suntecAnchor = 'const ANCHOR = "div.eventlist";';
    expect(/\bevents?\b/i.test(identifiersOnly(suntecAnchor))).toBe(false);

    const suntecRow = 'const IS_ROW = "article.eventlist-event";';
    expect(/\bevents?\b/i.test(identifiersOnly(suntecRow))).toBe(false);
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

  it("constructs a network client in exactly one place", () => {
    // ADR-0010: reaching the live internet is something a caller says out loud,
    // and the entry point is where it gets said. A second construction site is
    // how the default this ADR removed grows back — some module deciding for
    // its callers that they meant to be online.
    const constructors = files
      .filter(({ path, code }) => path !== "pipeline/http.ts" && /createHttpClient\s*\(/.test(code))
      .map(({ path }) => path);

    expect(constructors).toEqual(["main.ts"]);
  });

  it("constructs a browser session in exactly one place", () => {
    // Symmetric with the network-client guard above (ADR-0005, Amendment 2).
    // Headless is scoped to MBCCS by construction — `browser` is optional on
    // `FetchDeps` — but the *launch* is the other half: a second construction
    // site is how a browser becomes the default execution model by drift. The
    // provider owns the launch; only the entry point calls it.
    const constructors = files
      .filter(
        ({ path, code }) =>
          path !== "pipeline/browser.ts" && /createBrowserSession\s*\(/.test(code),
      )
      .map(({ path }) => path);

    expect(constructors).toEqual(["main.ts"]);
  });

  it("imports Playwright in exactly one place", () => {
    // The provider is the only module that names the browser library. An adapter
    // reaching for `playwright` directly would be constructing its own I/O — the
    // exact coupling the injected-session seam exists to prevent. Matched against
    // `raw`, because the import path is a string literal `code` has stripped.
    const importers = files
      .filter(({ raw }) => /from\s+["']playwright["']/.test(raw))
      .map(({ path }) => path);

    expect(importers).toEqual(["pipeline/browser.ts"]);
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
    expect(sources.map((source) => source.key)).toEqual(["suntec", "scc", "mbccs"]);
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
