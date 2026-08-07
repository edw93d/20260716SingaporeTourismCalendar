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
