import type { DomainRecord, Scraped, SourceId, SourceKey } from "../domain/types.js";

/**
 * The seam every scraper implements — ADR-0005 and ADR-0006.
 *
 * `fetch` does all the I/O and returns opaque `Raw`; `parse` is pure and
 * fixture-testable. Each source's scraper is **wholly unique** — the three
 * share no code. The interface constrains only the edges.
 */

/**
 * A rate-limited HTTP client. Adapters never construct one: the core owns
 * policy (user agent, per-host rate limit, timeout, retry) so that politeness
 * is **structural, not disciplinary**. An adapter has no other route to the
 * network, so the well-behaved-reader posture that the facts-only legal
 * position rests on cannot quietly lapse when a source is added in a hurry.
 */
export type HttpClient = {
  get(url: string): Promise<string>;
};

/**
 * A headless browser session, whose lifecycle the core owns.
 *
 * Injected **only** into adapters that declare a need — which is MBCCS and
 * nothing else. Suntec and Singapore Cruise Centre are server-rendered and
 * undefended, and headless must not become the default execution model.
 *
 * The primitives are the minimal honest set for "operate a UI until it yields
 * rows" (ADR-0005, Amendment 2). ADR-0005 originally sketched `{ goto, content }`;
 * `content()` was dropped because the one thing the adapter needs — the schedule's
 * stable UUID — lives only in the page's React state, never in the rendered HTML,
 * so a bytes snapshot structurally cannot carry it. `evaluate` is what reads that
 * state; `click` and `waitForFunction` are what drive the date filter and pager
 * and block on the async refetch each action triggers.
 */
export type BrowserSession = {
  /** Load a URL and wait for the document to load. */
  goto(url: string): Promise<void>;
  /**
   * Run an expression in the page and return its (JSON-serialisable) value. The
   * one primitive that reads what the rendered DOM does not carry — the records
   * array in React state, which month the picker shows, whether the pager can
   * advance.
   */
  evaluate<T>(expression: string): Promise<T>;
  /** Click the first element matching a selector — the date-picker and the pager. */
  click(selector: string): Promise<void>;
  /**
   * Block until an expression evaluates truthy in the page: hydration, and the
   * refetch each filter or pager action fires. This is the async settle a static
   * snapshot cannot express, which is why the session is more than `goto`.
   */
  waitForFunction(expression: string): Promise<void>;
};

/**
 * What the core injects into `fetch`.
 *
 * `browser` is **optional**, which is what scopes headless by construction: an
 * adapter that does not ask for one cannot acquire one, enforced by the type
 * rather than by a note in a doc.
 */
export type FetchDeps = {
  http: HttpClient;
  browser?: BrowserSession;
  now: () => Date;
};

/**
 * A row that could not be parsed.
 *
 * **Silently dropping a bad row is forbidden** — not stylistically, but because
 * it corrupts the domain model. A dropped row stops appearing, `lastSeenAt`
 * stops advancing, and it becomes indistinguishable from a genuine absence.
 * That launders a scraper defect into what looks like a domain observation, in
 * the exact part of the model built never to guess.
 */
export type ParseFailure = {
  /** If extraction got that far. */
  sourceKey?: SourceKey;
  /** The raw material that failed — travels with the failure so it is debuggable without re-scraping. */
  fragment: string;
  /** What the parser was looking for. */
  expected: string;
};

/**
 * Three outcomes, because **zero rows is ambiguous** (ADR-0006).
 *
 * Each parser declares a structural anchor, checked *before* any row is
 * examined. Anchor present with no rows means the source is genuinely empty —
 * a fact. Anchor absent means we are not looking at our document: a challenge
 * page, a redesign, or an error served with HTTP 200.
 *
 * This matters most at Singapore Cruise Centre, whose Imperva WAF is passive
 * but one flip from defending — and whose challenge page returns **HTTP 200**,
 * making it byte-plausible as a quiet week without the anchor.
 */
export type ParseResult<T> =
  | { ok: true; records: T[]; failures: ParseFailure[] }
  | { ok: false; reason: string };

/**
 * A source adapter.
 *
 * `Raw` is **opaque and adapter-owned**: the core passes it from `fetch` to
 * `parse` without inspecting it, so a caller cannot tell that MBCCS drove
 * Chrome for three seconds while Suntec spent 200ms on a GET. That is what
 * seals the headless leak at the type level.
 *
 * `now` is injected into `parse` so fixture tests do not drift as fixtures age
 * past the ~3-month window the sources publish.
 */
export type Source<T extends DomainRecord, Raw = unknown> = {
  readonly key: SourceId;
  /** All the I/O. */
  fetch(deps: FetchDeps): Promise<Raw>;
  /** Pure. */
  parse(raw: Raw, now: Date): ParseResult<Scraped<T>>;
};
