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
 * Strips comments and string literals, leaving only identifiers.
 *
 * Both exclusions are load-bearing. Comments legitimately *discuss* the banned
 * term — this file does, and so does the domain model. String literals hold
 * selectors we do not control: Suntec's structural anchor is
 * `article.eventlist-event`, so a guard that read string contents would forbid
 * the very selector the Suntec adapter is required to match on.
 */
const identifiersOnly = (code: string): string =>
  code
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/'(?:[^'\\]|\\.)*'/g, "''")
    .replace(/"(?:[^"\\]|\\.)*"/g, '""')
    .replace(/`(?:[^`\\]|\\.)*`/g, "``");

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
  it("is explicit and currently empty", () => {
    expect(sources).toEqual([]);
  });

  it("is an array, not a discovered map", () => {
    expect(Array.isArray(sources)).toBe(true);
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
