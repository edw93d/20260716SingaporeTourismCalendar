import { describe, expect, it } from "vitest";
import type { PortCall, SourceId, VenueEvent } from "../src/domain/types.js";
import { selectRun } from "../src/pipeline/select.js";
import type { Source, SourceManifest } from "../src/sources/types.js";

/**
 * **The on-demand scheduling seam, tested pure.** `selectRun` turns the
 * workflow's *"which source?"* input into the three facts a run needs — the
 * subset, whether a browser launches, and whether the freshness marker advances
 * (ADR-0028 §3, §6, §8) — with no store and no browser, which is the whole point
 * of its being a pure function. That the marker is then honoured lives one seam
 * down, in `pipeline.test.ts`'s run-marker block; here we only hold the decision.
 *
 * Fixtures are the barest `Source` shape `selectRun` reads — it touches only
 * `key` — so the file needs no Postgres and runs regardless of the store tests.
 */

const sourceOf = (key: SourceId): Source<VenueEvent> | Source<PortCall> => ({
  key,
  fetch: async () => {
    throw new Error("selectRun must not fetch");
  },
  parse: () => ({ ok: true, records: [], failures: [] }),
});

const suntec = sourceOf("suntec");
const scc = sourceOf("scc");
const mbccs = sourceOf("mbccs");

const registry: (Source<VenueEvent> | Source<PortCall>)[] = [suntec, scc, mbccs];

const browserless = (): SourceManifest => ({
  provenance: "first-hand",
  description: "server-rendered, no browser",
  needsBrowser: false,
});

const manifests: Record<SourceId, SourceManifest> = {
  suntec: browserless(),
  scc: browserless(),
  mbccs: { provenance: "first-hand", description: "live site", needsBrowser: true },
};

describe("selectRun", () => {
  it("runs the whole registry when no source is named", () => {
    // The nightly cadence, unchanged: an empty input is the whole registry, a
    // full run, and — because MBCCS is in it — a browser.
    const selection = selectRun(registry, manifests, undefined);

    expect(selection.sources).toEqual(registry);
    expect(selection.full).toBe(true);
    expect(selection.needsBrowser).toBe(true);
  });

  it("treats an empty string, and whitespace, as no source named", () => {
    // The workflow input defaults to `""`, and a human typing into the dispatch
    // box can leave a stray space; both mean "all", not an unknown source that
    // throws. Whitespace is trimmed before the lookup.
    for (const which of ["", "   "]) {
      const selection = selectRun(registry, manifests, which);
      expect(selection.sources).toEqual(registry);
      expect(selection.full).toBe(true);
    }
  });

  it("runs exactly the named source, and does not count it as a full run", () => {
    // The founding complaint's direct fix: name one, run one. A subset run is not
    // full, so the marker guard downstream leaves `generatedAt` untouched.
    const selection = selectRun(registry, manifests, "suntec");

    expect(selection.sources).toEqual([suntec]);
    expect(selection.full).toBe(false);
    expect(selection.needsBrowser).toBe(false);
  });

  it("launches a browser for a single browser-declaring source", () => {
    // The launch is manifest-driven per selected source, not per run: a by-hand
    // MBCCS run boots Chromium, a by-hand Suntec run boots none (asserted above).
    const selection = selectRun(registry, manifests, "mbccs");

    expect(selection.sources).toEqual([mbccs]);
    expect(selection.needsBrowser).toBe(true);
    expect(selection.full).toBe(false);
  });

  it("throws on an unknown source rather than falling back to all", () => {
    // A typo at the dispatch box must fail loudly. Silently running everything is
    // the exact thing the operator reaching for one source was trying to avoid,
    // and it would scrape all sources under a name that meant to scope down.
    expect(() => selectRun(registry, manifests, "suntek")).toThrow(/suntek/);
  });
});
