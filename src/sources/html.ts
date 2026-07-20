/**
 * HTML primitives shared by the adapters.
 *
 * The only code the adapters share, and the boundary is deliberate: nothing here
 * knows a URL, a selector, a field, or which source it is serving. `&amp;` decodes
 * the same in every document on the web, so a per-adapter copy buys no decoupling —
 * it only drifts. It already had: two copies, and one carried `hellip` while the
 * other did not (ADR-0005, Amendment 1).
 *
 * The test for adding anything here: would it read identically if written for a page
 * nobody has seen? Entity decoding would. Reading a cell by `data-label` would not —
 * that is source knowledge and belongs in the adapter.
 */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  // Escaped, not literal: a bare apostrophe inside a double-quoted string
  // desynchronises the quote-pairing the architecture guard does when it strips
  // literals, and everything after it in this file reads as code to that guard.
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  ldquo: "“",
  rdquo: "”",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

/**
 * Named and numeric character references, decimal or hex.
 *
 * An unrecognised reference is returned **whole rather than dropped**: a source
 * publishing `&eacute;` should surface as a visibly odd string a reader can report,
 * not as a silently shortened one nobody notices.
 */
export const decodeEntities = (value: string): string =>
  // `[xX]`, not `x?`: the body below branches on `#X` for uppercase-hex references,
  // which are legal HTML, but a lowercase-only pattern never matched one — so that
  // branch was unreachable and `&#X26;` passed through undecoded. Found by the first
  // test written against this module after it was extracted.
  value.replace(/&(#[xX]?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    if (body.startsWith("#")) {
      const code = body.startsWith("#x") || body.startsWith("#X")
        ? Number.parseInt(body.slice(2), 16)
        : Number.parseInt(body.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
    }
    return ENTITIES[body.toLowerCase()] ?? whole;
  });

/**
 * Tags out, entities decoded, runs of whitespace — including `&nbsp;` — collapsed.
 *
 * Tags are replaced by a space rather than removed, so `<td>a</td><td>b</td>` reads
 * as `a b` and not `ab`. Why a given adapter needs the tags gone is source knowledge
 * and documented at its call site.
 */
export const textOf = (html: string): string =>
  decodeEntities(html.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
