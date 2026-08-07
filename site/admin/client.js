// @ts-check

/**
 * The moderator spreadsheet's client layer — **the write half of #156**, the
 * counterpart to `site/calendar.js`'s read half. The page arrives server-rendered
 * (`src/server/admin.ts`): a table of records whose Review-state and Shown cells
 * are `.pill` buttons carrying the record's `uid` (on the row) and each flag's
 * current value. This module attaches the toggle: a click flips the flag under
 * the admin auth boundary and raises an **Undo** toast, and Undo reverts the exact
 * write (ADR-0024 §7 — hiding is genuinely reversible; nothing here retires a uid).
 *
 * Same seam discipline as the calendar client (#38): the one thing it cannot be
 * allowed to reach for itself — the network — is **injected** as `fetch`, and the
 * document is read from the mount root's owner, never a global. That injection is
 * what lets `tests/admin-client.test.ts` drive the whole pill→write→Undo loop
 * against jsdom with a fake `fetch`, asserting the exact request each click makes.
 * The page's bootstrap in the rendered HTML supplies the real `window.fetch`.
 *
 * Free software under AGPLv3 with the rest of the repository.
 *
 * @typedef {"hidden" | "reviewed"} ModerationFlag
 * @typedef {(input: string, init?: RequestInit) => Promise<Response>} FetchLike
 * @typedef {{ fetch: FetchLike }} MountOptions
 */

/** The one write route, guarded by the same Basic Auth boundary as the page (ADR-0030 §5). */
const FLAG_ROUTE = "/admin/flag";

/**
 * The label a pill shows for a flag at a value. `reviewed` reads as itself;
 * `hidden` reads through the Shown column, so a hidden record's pill says
 * "Hidden" and a shown one says "Shown" — the same words the server renders, kept
 * here so a click can relabel without a reload.
 * @param {ModerationFlag} flag
 * @param {boolean} value
 * @returns {string}
 */
const labelFor = (flag, value) =>
  flag === "reviewed" ? (value ? "Reviewed" : "Unreviewed") : value ? "Hidden" : "Shown";

/**
 * The short human name of a flag at a value, for the toast sentence — "Hidden",
 * "Shown", "Marked reviewed", "Marked unreviewed".
 * @param {ModerationFlag} flag
 * @param {boolean} value
 * @returns {string}
 */
const actionFor = (flag, value) =>
  flag === "reviewed" ? (value ? "Marked reviewed" : "Marked unreviewed") : value ? "Hidden" : "Shown";

/**
 * Writes a flag's value back onto its pill: the label, the `data-value` a later
 * click reads, and `aria-pressed` for both styling and assistive tech. One place,
 * so a click and an Undo relabel identically.
 * @param {HTMLButtonElement} pill
 * @param {ModerationFlag} flag
 * @param {boolean} value
 */
const applyState = (pill, flag, value) => {
  pill.dataset["value"] = String(value);
  pill.setAttribute("aria-pressed", String(value));
  pill.textContent = labelFor(flag, value);
};

/**
 * Reads the flag a pill toggles off its `data-flag`, validated against the closed
 * set — a pill the server did not render (or one mangled) is ignored rather than
 * posting an unknown column.
 * @param {HTMLButtonElement} pill
 * @returns {ModerationFlag | null}
 */
const flagOf = (pill) => {
  const flag = pill.dataset["flag"];
  return flag === "hidden" || flag === "reviewed" ? flag : null;
};

/**
 * Mounts the toggles into `root` (the admin page's `<body>`). Returns nothing;
 * the wiring lives on `root` for its lifetime, which is the page's.
 * @param {HTMLElement} root
 * @param {MountOptions} options
 */
export const mountAdmin = (root, options) => {
  const doc = root.ownerDocument;
  if (!doc) throw new Error("mountAdmin needs a root attached to a document.");
  const { fetch } = options;

  /** The single live toast, replaced (never stacked) by each new action. */
  let toast = /** @type {HTMLElement | null} */ (null);

  const clearToast = () => {
    if (toast) {
      toast.remove();
      toast = null;
    }
  };

  /**
   * Raises a toast, replacing any live one. With an `undo` it carries an **Undo**
   * button — for a flip that just landed, whose Undo posts the opposite value and,
   * on success, reverts the pill and clears the toast (the same code path as any
   * toggle, so an Undo is itself undoable). Without one it is a plain message —
   * the error path, which must *not* offer an Undo for a write that never landed.
   * @param {string} message
   * @param {(() => Promise<void>) | undefined} [undo]
   */
  const showToast = (message, undo) => {
    clearToast();
    const el = doc.createElement("div");
    el.className = "toast";
    el.setAttribute("role", "status");
    const text = doc.createElement("span");
    text.textContent = message;
    el.append(text);
    if (undo) {
      const button = doc.createElement("button");
      button.type = "button";
      button.className = "undo";
      button.textContent = "Undo";
      button.addEventListener("click", () => {
        void undo();
      });
      el.append(button);
    }
    root.append(el);
    toast = el;
  };

  /**
   * Sends one flag write and reports whether it landed. The pill is disabled
   * while the request is in flight so a double-click cannot race two writes; a
   * non-2xx or a thrown fetch leaves the pill exactly as it was and surfaces a
   * plain error toast, so the page never shows a state the store did not accept.
   * @param {HTMLButtonElement} pill
   * @param {string} uid
   * @param {ModerationFlag} flag
   * @param {boolean} value
   * @returns {Promise<boolean>}
   */
  const write = async (pill, uid, flag, value) => {
    pill.disabled = true;
    try {
      const response = await fetch(FLAG_ROUTE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ uid, flag, value }),
      });
      if (!response.ok) {
        showToast("Could not save that change.");
        return false;
      }
      applyState(pill, flag, value);
      return true;
    } catch {
      showToast("Could not save that change.");
      return false;
    } finally {
      pill.disabled = false;
    }
  };

  root.addEventListener("click", (rawEvent) => {
    const target = /** @type {Element | null} */ (rawEvent.target);
    const pill = target?.closest(".pill");
    if (!(pill instanceof HTMLButtonElement)) return;

    const flag = flagOf(pill);
    const row = pill.closest("tr[data-uid]");
    if (flag === null || !(row instanceof HTMLElement)) return;
    const uid = row.dataset["uid"];
    if (uid === undefined || uid === "") return;

    const current = pill.dataset["value"] === "true";
    const next = !current;
    const name = row.querySelector(".name")?.textContent ?? "this listing";

    void write(pill, uid, flag, next).then((ok) => {
      if (!ok) return;
      showToast(`${actionFor(flag, next)} “${name}”.`, async () => {
        const reverted = await write(pill, uid, flag, current);
        if (reverted) clearToast();
      });
    });
  });
};
