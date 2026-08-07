// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { instant } from "../src/domain/instant.js";
import type { VenueEvent } from "../src/domain/types.js";
import { renderAdminPage } from "../src/server/admin.js";
import { mountAdmin } from "../site/admin/client.js";

/**
 * **The admin client seam** (#156) — the write half of the moderator page, driven
 * against a real DOM (jsdom) with `fetch` injected. The page is server-rendered
 * (`src/server/admin.ts`); this seam proves that once `mountAdmin` attaches, a
 * click on a state pill posts the right flip to the right route, relabels the
 * pill, and raises an **Undo** that reverts the exact write (ADR-0024 §7). Nothing
 * here reaches the network — `mountAdmin` takes `fetch` as an argument, which is
 * the property that makes the interaction testable at all.
 *
 * The markup under test is the *real* `renderAdminPage` output, so the client and
 * the server rendering cannot drift on the data attributes the toggle reads.
 */

type FetchCall = { url: string; body: { uid: string; flag: string; value: boolean } };

/** A fake `fetch` that records each call and answers with a settable outcome. */
const fakeFetch = (ok = true) => {
  const calls: FetchCall[] = [];
  const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
    calls.push({ url, body: JSON.parse(String(init?.body)) });
    return { ok, json: async () => ({}) } as Response;
  };
  return { fetch, calls };
};

/** Lets the click handler's fetch chain settle — all microtasks, no real timers. */
const flush = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

const suntecEvent = (over: Partial<VenueEvent> = {}): VenueEvent => ({
  uid: "uid-ve-1@sg-tourism-calendar",
  sequence: 0,
  source: "suntec",
  sourceKey: "bni-vision1472026",
  name: "BNI Vision",
  start: instant("2026-07-17T04:00:00Z"),
  end: instant("2026-07-17T10:00:00Z"),
  venue: "Suntec Convention Centre",
  hall: "Level 4, Hall 404",
  hidden: false,
  reviewed: false,
  firstSeenAt: instant("2026-07-01T02:00:00Z"),
  lastSeenAt: instant("2026-07-01T02:00:00Z"),
  ...over,
});

/**
 * A fresh mount root per test. jsdom shares one `document` across the whole file,
 * and `mountAdmin` attaches its click listener to the root — so mounting into a
 * throwaway element (not the shared `body`) is what keeps one test's listener from
 * firing on the next test's click.
 */
let root: HTMLElement;

/** Renders the real admin markup into a fresh root and returns it. */
const renderInto = (events: VenueEvent[]): HTMLElement => {
  const html = renderAdminPage(events, () => undefined);
  const table = html.match(/<table[\s\S]*<\/table>/);
  if (table === null) throw new Error("admin markup had no table");
  root = document.createElement("div");
  root.innerHTML = table[0];
  document.body.append(root);
  return root;
};

const shownPill = (): HTMLButtonElement =>
  root.querySelector(".shown-state .pill") as HTMLButtonElement;
const reviewPill = (): HTMLButtonElement =>
  root.querySelector(".review-state .pill") as HTMLButtonElement;
const toast = (): HTMLElement | null => root.querySelector(".toast");

afterEach(() => {
  root?.remove();
});

describe("the state pills start from the server-rendered state", () => {
  beforeEach(() => renderInto([suntecEvent()]));

  it("shows a Shown pill and an Unreviewed pill for a fresh record", () => {
    mountAdmin(root, { fetch: fakeFetch().fetch });
    expect(shownPill().textContent).toBe("Shown");
    expect(shownPill().dataset["value"]).toBe("false");
    expect(reviewPill().textContent).toBe("Unreviewed");
  });
});

describe("clicking a pill writes the flip and raises Undo", () => {
  it("posts hidden=true to /admin/flag, relabels the pill, and shows an Undo toast", async () => {
    renderInto([suntecEvent()]);
    const { fetch, calls } = fakeFetch();
    mountAdmin(root, { fetch });

    shownPill().click();
    await flush();

    expect(calls).toEqual([
      { url: "/admin/flag", body: { uid: "uid-ve-1@sg-tourism-calendar", flag: "hidden", value: true } },
    ]);
    expect(shownPill().textContent).toBe("Hidden");
    expect(shownPill().getAttribute("aria-pressed")).toBe("true");

    const raised = toast();
    expect(raised).not.toBeNull();
    expect(raised?.textContent).toContain("Hidden");
    expect(raised?.querySelector("button")?.textContent).toBe("Undo");
  });

  it("undo posts the opposite value, reverts the pill, and clears the toast", async () => {
    renderInto([suntecEvent()]);
    const { fetch, calls } = fakeFetch();
    mountAdmin(root, { fetch });

    shownPill().click();
    await flush();
    (toast()?.querySelector("button") as HTMLButtonElement).click();
    await flush();

    expect(calls.map((c) => c.body.value)).toEqual([true, false]);
    expect(calls.every((c) => c.body.flag === "hidden")).toBe(true);
    expect(shownPill().textContent).toBe("Shown");
    expect(shownPill().getAttribute("aria-pressed")).toBe("false");
    expect(toast()).toBeNull();
  });

  it("toggles reviewed independently — the hidden pill is never touched", async () => {
    // Independence (ADR-0024 §2): marking reviewed posts only the reviewed flag
    // and leaves the Shown pill exactly as the server rendered it.
    renderInto([suntecEvent()]);
    const { fetch, calls } = fakeFetch();
    mountAdmin(root, { fetch });

    reviewPill().click();
    await flush();

    expect(calls).toEqual([
      { url: "/admin/flag", body: { uid: "uid-ve-1@sg-tourism-calendar", flag: "reviewed", value: true } },
    ]);
    expect(reviewPill().textContent).toBe("Reviewed");
    expect(shownPill().textContent).toBe("Shown");
    expect(shownPill().dataset["value"]).toBe("false");
  });

  it("names the clicked record in the Undo toast", async () => {
    renderInto([suntecEvent({ name: "Cellar Fiesta" })]);
    const { fetch } = fakeFetch();
    mountAdmin(root, { fetch });

    shownPill().click();
    await flush();

    expect(toast()?.textContent).toContain("Cellar Fiesta");
  });
});

describe("a rejected write leaves the page honest", () => {
  it("does not relabel the pill when the server refuses the write", async () => {
    // The pill must never show a state the store did not accept — a non-ok
    // response leaves it exactly as it was and surfaces an error instead.
    renderInto([suntecEvent()]);
    const { fetch } = fakeFetch(false);
    mountAdmin(root, { fetch });

    shownPill().click();
    await flush();

    expect(shownPill().textContent).toBe("Shown");
    expect(shownPill().dataset["value"]).toBe("false");
    expect(toast()?.textContent).toContain("Could not save");
    // No Undo on a write that never landed — Undo is tied to a flip that did.
    expect(toast()?.querySelector("button")).toBeNull();
  });
});

describe("mountAdmin only acts on its own pills", () => {
  it("ignores a click that is not on a pill", async () => {
    renderInto([suntecEvent()]);
    const { fetch, calls } = fakeFetch();
    mountAdmin(root, { fetch });

    (root.querySelector(".name") as HTMLElement).click();
    await flush();

    expect(calls).toEqual([]);
    expect(toast()).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// The grid — sort, funnel filters, and the filter-then-bulk bar (#157).
// ---------------------------------------------------------------------------

/** The visible (non-filtered) rows' uids, in DOM order — the read the grid drives. */
const visibleUids = (): string[] =>
  Array.from(root.querySelectorAll<HTMLElement>("tbody tr[data-uid]"))
    .filter((tr) => !tr.hidden)
    .map((tr) => tr.dataset["uid"] ?? "");

/** All rows' uids in DOM order, ignoring visibility — for asserting sort order. */
const orderedUids = (): string[] =>
  Array.from(root.querySelectorAll<HTMLElement>("tbody tr[data-uid]")).map(
    (tr) => tr.dataset["uid"] ?? "",
  );

const th = (key: string): HTMLElement => root.querySelector(`th[data-key="${key}"]`) as HTMLElement;
const funnelOf = (key: string): HTMLButtonElement =>
  th(key).querySelector(".funnel") as HTMLButtonElement;
const openMenu = (): HTMLElement => root.querySelector(".menu") as HTMLElement;
const menuBox = (value: string): HTMLInputElement =>
  Array.from(openMenu().querySelectorAll<HTMLInputElement>("input[type=checkbox]")).find(
    (b) => b.value === value,
  ) as HTMLInputElement;

/** A small, varied corpus: two venues, two months, three sources, mixed state. */
const corpus = (): VenueEvent[] => [
  suntecEvent({ uid: "u1", name: "Alpha", venue: "Suntec", source: "suntec", start: instant("2026-07-17T04:00:00Z") }),
  suntecEvent({ uid: "u2", name: "Bravo", venue: "Marina Bay Sands", source: "sistic", start: instant("2026-08-02T04:00:00Z") }),
  suntecEvent({ uid: "u3", name: "Charlie", venue: "Suntec", source: "eventseye", start: instant("2026-08-10T04:00:00Z") }),
  suntecEvent({ uid: "u4", name: "Delta", venue: "Suntec", source: "suntec", start: instant("2026-07-20T04:00:00Z"), hidden: true }),
];

describe("clicking a column label sorts the rows (#157)", () => {
  it("sorts a text column ascending, then descending on a second click", () => {
    renderInto([
      suntecEvent({ uid: "u2", name: "Bravo" }),
      suntecEvent({ uid: "u1", name: "Alpha" }),
      suntecEvent({ uid: "u3", name: "Charlie" }),
    ]);
    mountAdmin(root, { fetch: fakeFetch().fetch });

    th("name").click();
    expect(orderedUids()).toEqual(["u1", "u2", "u3"]); // Alpha, Bravo, Charlie
    expect(th("name").getAttribute("aria-sort")).toBe("ascending");

    th("name").click();
    expect(orderedUids()).toEqual(["u3", "u2", "u1"]);
    expect(th("name").getAttribute("aria-sort")).toBe("descending");
  });

  it("sorts the date column chronologically, not by the display string", () => {
    // Ascending by Start must order Jul 17 < Jul 20 < Aug 2 < Aug 10 — which the
    // alphabetised display ("17 Jul" vs "2 Aug") would get wrong. The numeric
    // data-sort is what makes the chronological order hold.
    renderInto(corpus());
    mountAdmin(root, { fetch: fakeFetch().fetch });

    th("start").click();
    expect(orderedUids()).toEqual(["u1", "u4", "u2", "u3"]);
  });
});

describe("per-column funnel filters compose (#157)", () => {
  it("puts a funnel on the filter-able columns but not on free-text Event", () => {
    renderInto(corpus());
    mountAdmin(root, { fetch: fakeFetch().fetch });

    expect(funnelOf("venue")).not.toBeNull();
    expect(funnelOf("start")).not.toBeNull();
    expect(th("name").querySelector(".funnel")).toBeNull();
  });

  it("filters to one venue in one month across all sources — filters AND together", () => {
    renderInto(corpus());
    mountAdmin(root, { fetch: fakeFetch().fetch });

    // Venue funnel → keep only Suntec.
    funnelOf("venue").click();
    menuBox("Marina Bay Sands").click(); // uncheck the other venue
    // u1 (Jul), u3 (Aug), u4 (Jul) are Suntec; u2 (MBS) is filtered out.
    expect(visibleUids().sort()).toEqual(["u1", "u3", "u4"]);

    // Start funnel → keep only Aug 2026. This composes with the venue filter.
    funnelOf("start").click();
    menuBox("Jul 2026").click(); // uncheck July, leaving August
    // Suntec AND August → only u3.
    expect(visibleUids()).toEqual(["u3"]);

    // The headers with an active filter are flagged.
    expect(th("venue").classList.contains("filtered")).toBe(true);
    expect(th("start").classList.contains("filtered")).toBe(true);
    expect(th("source").classList.contains("filtered")).toBe(false); // untouched
  });

  it("re-checking every value clears the column's filter", () => {
    renderInto(corpus());
    mountAdmin(root, { fetch: fakeFetch().fetch });

    funnelOf("venue").click();
    menuBox("Marina Bay Sands").click(); // filter on
    expect(th("venue").classList.contains("filtered")).toBe(true);
    menuBox("Marina Bay Sands").click(); // back to all checked
    expect(th("venue").classList.contains("filtered")).toBe(false);
    expect(visibleUids().length).toBe(4);
  });

  it("orders a month funnel chronologically, not alphabetically", () => {
    renderInto(corpus());
    mountAdmin(root, { fetch: fakeFetch().fetch });

    funnelOf("start").click();
    const labels = Array.from(openMenu().querySelectorAll<HTMLElement>("label span")).map(
      (s) => s.textContent,
    );
    expect(labels).toEqual(["Jul 2026", "Aug 2026"]);
  });
});

describe("the bulk bar moderates the filtered selection (#157)", () => {
  type BulkCall = { url: string; body: { uids: string[]; flag: string; value: boolean } };
  const bulkFetch = (ok = true) => {
    const calls: BulkCall[] = [];
    const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return { ok, json: async () => ({}) } as Response;
    };
    return { fetch, calls };
  };

  const bulkButton = (text: string): HTMLButtonElement =>
    Array.from(root.querySelectorAll<HTMLButtonElement>(".bulkbar button")).find(
      (b) => b.textContent === text,
    ) as HTMLButtonElement;
  const bulkCount = (): string => (root.querySelector(".bulkbar .count") as HTMLElement).textContent ?? "";

  it("shows a live count of the rows the filters leave", () => {
    renderInto(corpus());
    mountAdmin(root, { fetch: bulkFetch().fetch });

    expect(bulkCount()).toBe("4 records shown");

    funnelOf("venue").click();
    menuBox("Marina Bay Sands").click();
    expect(bulkCount()).toBe("3 records shown"); // the three Suntec rows
  });

  it("hides only the filtered, currently-shown rows and raises one Undo toast", async () => {
    renderInto(corpus());
    const { fetch, calls } = bulkFetch();
    mountAdmin(root, { fetch });

    // Filter to Suntec: u1, u3, u4 — but u4 is already hidden, so a Hide targets
    // only the two that actually change (u1, u3), which is what Undo can restore.
    funnelOf("venue").click();
    menuBox("Marina Bay Sands").click();
    bulkButton("Hide").click();
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/admin/flag/bulk");
    expect(calls[0]?.body.flag).toBe("hidden");
    expect(calls[0]?.body.value).toBe(true);
    expect(calls[0]?.body.uids.sort()).toEqual(["u1", "u3"]);

    const raised = toast();
    expect(raised?.textContent).toContain("Hidden 2 records");
    expect(raised?.querySelector("button")?.textContent).toBe("Undo");
    // The two pills now read Hidden.
    const shown = (uid: string) =>
      root.querySelector(`tr[data-uid="${uid}"] .shown-state .pill`) as HTMLElement;
    expect(shown("u1").textContent).toBe("Hidden");
    expect(shown("u3").textContent).toBe("Hidden");
  });

  it("undo posts the inverse for the same selection and clears the toast", async () => {
    renderInto(corpus());
    const { fetch, calls } = bulkFetch();
    mountAdmin(root, { fetch });

    bulkButton("Mark reviewed").click();
    await flush();
    (toast()?.querySelector("button") as HTMLButtonElement).click();
    await flush();

    // Two calls: mark-reviewed-true over the four, then reviewed-false over the
    // same four — the exact inverse (ADR-0024 §7).
    expect(calls).toHaveLength(2);
    expect(calls.map((c) => c.body.value)).toEqual([true, false]);
    expect(calls.every((c) => c.body.flag === "reviewed")).toBe(true);
    expect(calls[0]?.body.uids.sort()).toEqual(calls[1]?.body.uids.sort());
    expect(toast()).toBeNull();
  });

  it("does nothing but report when the selection has nothing to change", async () => {
    // Every row is already shown, so a Show acts on none — no write, and a plain
    // message rather than an Undo for a write that never happened.
    renderInto([
      suntecEvent({ uid: "u1", name: "Alpha" }),
      suntecEvent({ uid: "u2", name: "Bravo" }),
    ]);
    const { fetch, calls } = bulkFetch();
    mountAdmin(root, { fetch });

    bulkButton("Show").click();
    await flush();

    expect(calls).toEqual([]);
    expect(toast()?.textContent).toContain("No records to show");
    expect(toast()?.querySelector("button")).toBeNull();
  });

  it("leaves the pills untouched when the bulk write is refused", async () => {
    renderInto(corpus());
    const { fetch } = bulkFetch(false);
    mountAdmin(root, { fetch });

    bulkButton("Hide").click();
    await flush();

    const shown = root.querySelector(`tr[data-uid="u1"] .shown-state .pill`) as HTMLElement;
    expect(shown.textContent).toBe("Shown"); // unchanged — the store refused it
    expect(toast()?.textContent).toContain("Could not save");
  });
});

// ---------------------------------------------------------------------------
// The hand-entry manual write path — the ＋ Add event modal (#158, ADR-0024 §9).
// ---------------------------------------------------------------------------

describe("the ＋ Add event modal writes a manual row (#158)", () => {
  type EntryCall = { url: string; body: Record<string, unknown> };
  /** A fake `fetch` that records url + parsed body and answers with a settable outcome. */
  const entryFetch = (ok = true) => {
    const calls: EntryCall[] = [];
    const fetch = async (url: string, init?: RequestInit): Promise<Response> => {
      calls.push({ url, body: JSON.parse(String(init?.body)) });
      return { ok, json: async () => ({}) } as Response;
    };
    return { fetch, calls };
  };

  const addButton = (): HTMLButtonElement => root.querySelector(".add-event") as HTMLButtonElement;
  const modal = (): HTMLElement | null => root.querySelector(".entry-modal");
  const field = (name: string): HTMLInputElement =>
    root.querySelector(`.entry-form [name="${name}"]`) as HTMLInputElement;
  const entrySubmit = (): HTMLButtonElement =>
    root.querySelector(".entry-submit") as HTMLButtonElement;
  const shownError = (): HTMLElement | null => root.querySelector(".entry-error:not([hidden])");

  /** Fills a complete, valid form. Individual tests then clear one field to test a guard. */
  const fillComplete = (): void => {
    field("name").value = "Community Health Fair";
    field("venue").value = "Marina Bay Sands Expo";
    field("hall").value = "Hall B";
    field("start").value = "2026-09-01T10:00";
    field("end").value = "2026-09-01T17:00";
  };

  it("opens a modal with exactly five fields and no description — facts only", () => {
    renderInto([suntecEvent()]);
    mountAdmin(root, { fetch: entryFetch().fetch, reload: () => {} });

    // Starts closed; the button opens it.
    expect(modal()?.hidden).toBe(true);
    addButton().click();
    expect(modal()?.hidden).toBe(false);

    // Name, venue, hall, start, end — and nothing else. No description field: the
    // model has none (ADR-0024 §9), so there is nowhere to type copyrightable prose.
    const inputs = modal()!.querySelectorAll("input");
    expect(inputs).toHaveLength(5);
    expect(modal()!.querySelector("textarea")).toBeNull();
    expect(modal()!.querySelector('[name="description"]')).toBeNull();
    for (const name of ["name", "venue", "hall", "start", "end"]) {
      expect(field(name)).not.toBeNull();
    }
  });

  it("refuses to post without a venue, and refuses to post without an end", async () => {
    // It will not invent a venue or guess an end (ADR-0024 §9): a form missing
    // either never reaches the network, and the modal stays open with an error.
    renderInto([suntecEvent()]);
    const { fetch, calls } = entryFetch();
    mountAdmin(root, { fetch, reload: () => {} });
    addButton().click();

    fillComplete();
    field("venue").value = "   "; // whitespace is no venue
    entrySubmit().click();
    await flush();
    expect(calls).toEqual([]);
    expect(modal()?.hidden).toBe(false);
    expect(shownError()).not.toBeNull();

    fillComplete();
    field("end").value = ""; // no end
    entrySubmit().click();
    await flush();
    expect(calls).toEqual([]);
  });

  it("posts the facts to /admin/entry with the fixed +08:00 offset, then reloads", async () => {
    renderInto([suntecEvent()]);
    const { fetch, calls } = entryFetch();
    let reloaded = 0;
    mountAdmin(root, { fetch, reload: () => void reloaded++ });
    addButton().click();

    fillComplete();
    entrySubmit().click();
    await flush();

    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("/admin/entry");
    // The datetime-local values carry no zone; the client stamps the Singapore
    // offset so the server never has to assume one (ADR-0003).
    expect(calls[0]?.body).toEqual({
      name: "Community Health Fair",
      venue: "Marina Bay Sands Expo",
      hall: "Hall B",
      start: "2026-09-01T10:00+08:00",
      end: "2026-09-01T17:00+08:00",
    });
    // On success the row exists in the store; the page reloads so it appears
    // through the same server render as every other row, and the modal closes.
    expect(reloaded).toBe(1);
    expect(modal()?.hidden).toBe(true);
  });

  it("sends a null hall when the optional room is left blank — no invented room", async () => {
    renderInto([suntecEvent()]);
    const { fetch, calls } = entryFetch();
    mountAdmin(root, { fetch, reload: () => {} });
    addButton().click();

    fillComplete();
    field("hall").value = "";
    entrySubmit().click();
    await flush();

    expect(calls[0]?.body.hall).toBeNull();
  });

  it("keeps the modal open and does not reload when the server refuses the write", async () => {
    renderInto([suntecEvent()]);
    const { fetch } = entryFetch(false);
    let reloaded = 0;
    mountAdmin(root, { fetch, reload: () => void reloaded++ });
    addButton().click();

    fillComplete();
    entrySubmit().click();
    await flush();

    // A refused write must not reload past a modal the operator can retry from.
    expect(modal()?.hidden).toBe(false);
    expect(reloaded).toBe(0);
    expect(shownError()?.textContent).toContain("Could not add");
  });
});
