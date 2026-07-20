/**
 * Strips comments, string literals and regex literals from JavaScript/TypeScript
 * source, leaving only identifiers.
 *
 * Extracted from `tests/architecture.test.ts`, whose job is asserting rules
 * rather than housing the machinery a rule needs. It lives here so the assertions
 * there read as assertions.
 *
 * All three exclusions are load-bearing. Comments legitimately *discuss* a banned
 * term — the architecture test does, and so does the domain model. String and
 * regex literals hold **markup and URLs we do not control**: Suntec's row class is
 * `eventlist-event` and its anchor is `div.eventlist`, so a guard that read their
 * contents would forbid the very selectors the adapter is required to match on.
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
export const identifiersOnly = (code: string): string => {
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
        if (c === "\\") {
          i += 2;
        } else if (c === "[") {
          inClass = true;
          i += 1;
        } else if (c === "]") {
          inClass = false;
          i += 1;
        } else if (c === "/" && !inClass) {
          break;
        } else if (c === "\n") {
          break;
        } else {
          i += 1;
        }
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
