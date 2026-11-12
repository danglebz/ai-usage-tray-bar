// Panel UI. Plain JavaScript because Chromium cannot strip types the way the main process's
// Node can, and this project has no bundler by design. It is type-checked through JSDoc
// (tsconfig.renderer.json) against the same src/types.ts the main process uses.
// @ts-check
"use strict";

/** @typedef {import("../types.ts").UsageState} UsageState */
/** @typedef {import("../types.ts").PublicConfig} PublicConfig */
/** @typedef {import("../types.ts").Severity} Severity */
/** @typedef {import("../types.ts").Status} Status */

/**
 * Query one element that the markup guarantees exists.
 * @template {Element} [T=HTMLElement]
 * @param {string} selector
 * @returns {T}
 */
function $(selector) {
  const node = document.querySelector(selector);
  if (!node) throw new Error(`missing element: ${selector}`);
  return /** @type {T} */ (node);
}

const viewUsage = $("#viewUsage");
const viewSettings = $("#viewSettings");
const settingsForm = /** @type {HTMLFormElement} */ ($("#settingsForm"));
/** @type {UsageState} */
let state = { at: null, refreshing: false, results: [] };

/**
 * @typedef {Record<string, string | ((e: Event) => void) | Partial<CSSStyleDeclaration>>} Attrs
 */

/**
 * Create an element. `class`, `text`, `style` (an object; the CSP forbids the style attribute
 * but CSSOM is fine) and `on<event>` are handled specially; everything else is an attribute.
 * @param {string} tag
 * @param {Attrs} [attrs]
 * @param {...(Node | string | null | undefined)} children
 * @returns {HTMLElement}
 */
function el(tag, attrs = {}, ...children) {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class" && typeof v === "string") n.className = v;
    else if (k === "style" && typeof v === "object") Object.assign(n.style, v);
    else if (k === "text" && typeof v === "string") n.textContent = v;
    else if (k.startsWith("on") && typeof v === "function") n.addEventListener(k.slice(2), v);
    else if (typeof v === "string") n.setAttribute(k, v);
  }
  for (const c of children) if (c != null) n.append(c);
  return n;
}

/** @param {string | null} iso */
function relReset(iso) {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "resetting…";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 48) return `resets in ${Math.round(h / 24)}d`;
  if (h >= 1) return `resets in ${h}h ${m}m`;
  return `resets in ${m}m`;
}

/** @param {number | null} at */
function relStamp(at) {
  if (!at) return "";
  const s = Math.round((Date.now() - at) / 1000);
  if (s < 60) return "just now";
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
}

/** @type {Partial<Record<Status, string>>} */
const STATUS_TEXT = {
  not_configured: "Not configured",
  not_logged_in: "Not logged in",
  expired: "Token expired",
  error: "Error",
};

/** @type {Record<Severity, number>} */
const RANK = { unknown: 0, normal: 1, warning: 2, critical: 3 };

/** Provider id of the card being dragged. While set, refreshes wait so the DOM stays put. */
/** @type {string | null} */
let draggingId = null;
let renderPending = false;

/**
 * What a screen reader says for a card: the name, and the shortcut that is otherwise invisible.
 * @param {string} name
 */
const cardLabel = (name) => `${name}. Alt+Up Arrow or Alt+Down Arrow moves this card.`;

/**
 * The announcement after a keyboard move.
 * @param {string} name @param {number} position @param {number} total
 */
const movedText = (name, position, total) => `Moved ${name} to position ${position} of ${total}`;

/** Provider id of the card that holds focus, or of the card around the focused control in it. */
function focusedCardId() {
  const active = document.activeElement;
  const card = active instanceof Element ? active.closest(".card") : null;
  return card instanceof HTMLElement && viewUsage.contains(card) ? (card.dataset.provider ?? null) : null;
}

function renderUsage() {
  if (draggingId) {
    renderPending = true;
    return;
  }
  // Rebuilding the list drops focus along with the old cards, and every refresh broadcast
  // rebuilds it, so the focused card is found again by its provider id afterwards.
  const focusedId = focusedCardId();
  /** @type {HTMLElement | null} */
  let refocus = null;
  viewUsage.replaceChildren();
  if (!state.results.length) {
    viewUsage.append(el("div", { class: "empty", text: state.refreshing ? "Loading…" : "No providers enabled." }));
  }
  /** @type {Severity} */
  let worst = "unknown";
  for (const r of state.results) {
    const tone = r.status === "ok" ? "" : r.status === "error" || r.status === "expired" ? "err" : "idle";
    // role="group" so the label has something to name: aria-label on a bare div is ignored.
    const card = el("div", {
      class: `card ${tone}`,
      "data-provider": r.id,
      draggable: "true",
      tabindex: "0",
      role: "group",
      "aria-label": cardLabel(r.name),
    });
    if (r.id === focusedId) refocus = card;
    const head = el("div", { class: "head" }, el("span", { class: "name", text: r.name }));
    if (r.plan) head.append(el("span", { class: "plan", text: r.plan }));
    if (r.source === "local") head.append(el("span", { class: "badge", text: "local" }));
    if (r.account) head.append(el("span", { class: "acct", text: r.account, title: r.account }));
    card.append(head);

    if (r.status !== "ok") {
      card.append(el("div", { class: "status", text: `${STATUS_TEXT[r.status] ?? r.status}: ${r.message ?? ""}` }));
    }

    for (const w of r.windows) {
      if (RANK[w.severity] > RANK[worst]) worst = w.severity;
      const pctText = w.percent == null ? "—" : `${Math.round(w.percent)}%`;
      const row = el(
        "div",
        { class: "win" },
        el(
          "div",
          { class: "lbl" },
          el("span", { text: w.label }),
          el("span", { class: "reset", text: relReset(w.resetsAt) }),
          el("span", { class: "pct", text: pctText }),
        ),
        el(
          "div",
          {
            class: `bar ${w.severity}`,
            role: "progressbar",
            "aria-label": w.label,
            "aria-valuemin": "0",
            "aria-valuemax": "100",
            ...(w.percent == null ? {} : { "aria-valuenow": String(w.percent) }),
            "aria-valuetext": w.percent == null ? (w.detail ?? "Usage percentage unavailable") : pctText,
          },
          el("i", { style: { width: `${w.percent ?? 0}%` } }),
        ),
      );
      if (w.detail) row.append(el("div", { class: "detail", text: w.detail }));
      card.append(row);
    }

    if (r.extras.length) {
      const ex = el("div", { class: "extras" });
      for (const x of r.extras)
        ex.append(el("span", {}, `${x.label}: `, x.url ? extLink(x.url, x.value) : el("b", { text: x.value })));
      card.append(ex);
    }
    if (r.status === "ok" && r.message) card.append(el("div", { class: "status note", text: r.message }));
    viewUsage.append(card);
  }
  // Not scrolled to: a timer-driven rebuild must not yank back a list the user scrolled away.
  refocus?.focus({ preventScroll: true });
  $("#headDot").className = `dot ${worst}`;
  $("#stamp").textContent = state.refreshing ? "refreshing…" : relStamp(state.at);
  $("#btnRefresh").classList.toggle("spin", !!state.refreshing);
}

/** Provider ids of the cards as they currently sit, top to bottom. */
function cardIds() {
  return [...viewUsage.querySelectorAll(".card")].map(
    (c) => (c instanceof HTMLElement ? c.dataset.provider : "") ?? "",
  );
}

/**
 * Keep a new card order: sort the local state to match, so a redraw does not snap the cards
 * back, and hand it to main, which stores it and broadcasts the re-sorted state.
 * @param {string[]} ids provider ids, top to bottom
 */
function commitOrder(ids) {
  state = { ...state, results: [...state.results].sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id)) };
  void window.api.setCardOrder(ids);
}

/**
 * The first card whose middle is below `y`, i.e. the one the dragged card goes in front of.
 * @param {number} y
 */
function cardBelow(y) {
  for (const card of viewUsage.querySelectorAll(".card:not(.dragging)")) {
    const box = card.getBoundingClientRect();
    if (y < box.top + box.height / 2) return card;
  }
  return null;
}

// Cards reorder by dragging. The card moves live while dragging; letting go stores the order
// (main re-sorts and broadcasts it back), and Esc or a drop outside the list puts it back.
let orderBefore = "";
// Whether the drag ended in a drop on the list. Tracked here rather than read from dragend's
// dropEffect, which is not reliable enough to tell a drop from a cancel.
let dropped = false;
viewUsage.addEventListener("dragstart", (e) => {
  const card = e.target instanceof Element ? e.target.closest(".card") : null;
  if (!(card instanceof HTMLElement) || !card.dataset.provider || !e.dataTransfer) return;
  draggingId = card.dataset.provider;
  dropped = false;
  orderBefore = cardIds().join("\n");
  e.dataTransfer.effectAllowed = "move";
  e.dataTransfer.setData("text/plain", draggingId);
  // Faded only after Chromium has taken the drag image, so the image itself stays solid.
  requestAnimationFrame(() => card.classList.add("dragging"));
});
viewUsage.addEventListener("dragover", (e) => {
  if (!draggingId) return;
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = "move";
  const dragged = viewUsage.querySelector(".card.dragging");
  if (!dragged) return;
  const below = cardBelow(e.clientY);
  if (below) {
    if (below !== dragged.nextElementSibling) viewUsage.insertBefore(dragged, below);
  } else if (dragged !== viewUsage.lastElementChild) viewUsage.append(dragged);
});
viewUsage.addEventListener("drop", (e) => {
  if (!draggingId) return;
  e.preventDefault();
  dropped = true;
});
viewUsage.addEventListener("dragend", () => {
  if (!draggingId) return;
  draggingId = null;
  viewUsage.querySelector(".card.dragging")?.classList.remove("dragging");
  const ids = cardIds();
  const cancelled = !dropped;
  if (!cancelled && ids.join("\n") !== orderBefore) commitOrder(ids);
  // Cancelled: redraw from `state`, which still holds the order from before the drag.
  if (cancelled || renderPending) {
    renderPending = false;
    renderUsage();
  }
});

// The same reorder without a pointer (WCAG 2.1.1, 2.5.7): Alt+Up / Alt+Down moves the focused
// card one place. Alt keeps plain arrows free to scroll the list.
viewUsage.addEventListener("keydown", (e) => {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
  const step = e.key === "ArrowUp" ? -1 : e.key === "ArrowDown" ? 1 : 0;
  const card = e.target instanceof Element ? e.target.closest(".card") : null;
  if (!step || !(card instanceof HTMLElement) || !card.dataset.provider) return;
  // Also at the ends of the list, where nothing moves but the view must not scroll either.
  e.preventDefault();
  if (draggingId) return;
  const id = card.dataset.provider;
  const ids = cardIds();
  const from = ids.indexOf(id);
  const to = from + step;
  if (from < 0 || to < 0 || to >= ids.length) return;
  ids.splice(to, 0, ...ids.splice(from, 1));
  commitOrder(ids);
  // Redraw now rather than wait for main's broadcast; renderUsage keeps focus on the card.
  renderUsage();
  viewUsage.querySelector(`.card[data-provider="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "nearest" });
  const name = state.results.find((r) => r.id === id)?.name ?? id;
  $("#announce").textContent = movedText(name, to + 1, ids.length);
});

/**
 * A link that opens in the real browser. A plain <a href> inside the panel would either
 * navigate the panel itself or be blocked, so the click goes through the main process,
 * which is also the only place allowed to decide what URLs may open.
 * @param {string} url
 * @param {string} text
 */
function extLink(url, text) {
  return el("a", {
    class: "ext",
    href: "#",
    // Links drag on their own by default, which would hijack a card drag started on one.
    draggable: "false",
    title: url,
    text: `${text} ↗`,
    onclick: (e) => {
      e.preventDefault();
      void window.api.openExternal(url);
    },
  });
}

/**
 * The form's named controls, typed. `form.elements` is a live collection keyed by name.
 * @param {string} name
 * @returns {HTMLInputElement}
 */
function field(name) {
  return /** @type {HTMLInputElement} */ (settingsForm.elements.namedItem(name));
}

async function renderSettings() {
  const cfg = await window.api.getConfig();
  field("refreshMinutes").value = String(cfg.refreshMinutes);
  field("notifyAtPercent").value = String(cfg.notifyAtPercent);
  field("openAtLogin").checked = !!cfg.openAtLogin;

  const box = $("#providerSettings");
  box.replaceChildren();
  for (const p of cfg.providerMeta) {
    /** @type {Record<string, unknown>} */
    const pc = cfg.providers[p.id] ?? {};
    // The name and its switch share one row: the switch is the section heading's control,
    // so a whole provider turns off without hunting for a checkbox underneath it.
    const toggle = el("input", {
      type: "checkbox",
      class: "switch",
      name: `providers.${p.id}.enabled`,
      "aria-label": `Enable ${p.name}`,
      ...(pc.enabled !== false ? { checked: "" } : {}),
    });
    const sec = el(
      "section",
      { "data-provider": p.id, class: pc.enabled !== false ? "" : "off" },
      el("label", { class: "secHead" }, el("h2", { text: p.name }), toggle),
    );
    // A provider that is switched off shows only its heading: its fields are irrelevant until
    // it is switched back on, and listing them all made the page too long to scan.
    toggle.addEventListener("change", () =>
      sec.classList.toggle("off", !(/** @type {HTMLInputElement} */ (toggle).checked)),
    );
    if (p.help) sec.append(el("div", { class: "help", text: p.help }));
    for (const f of p.fields) {
      const input = el("input", {
        type: f.secret ? "password" : "text",
        name: `providers.${p.id}.${f.key}`,
        value: String(pc[f.key] ?? ""),
        ...(f.placeholder ? { placeholder: f.placeholder } : {}),
        autocomplete: "off",
        spellcheck: "false",
      });
      // Label on the left, "where do I get this" link on the right of the same line.
      const head = el("div", { class: "fieldHead" }, el("span", { class: "hint", text: f.label }));
      if (f.docUrl) head.append(extLink(f.docUrl, f.docLabel ?? "Get key"));
      sec.append(el("label", {}, head, input));
      if (f.help) sec.append(el("div", { class: "help", text: f.help }));
    }
    box.append(sec);
  }
  wireAutoSave();
}

/**
 * Value to store for one input, matching the type the config expects.
 * @param {HTMLInputElement} input
 * @returns {string | number | boolean}
 */
function inputValue(input) {
  if (input.type === "checkbox") return input.checked;
  if (input.type === "number") return Number(input.value) || (input.name === "refreshMinutes" ? 3 : 0);
  return input.value.trim();
}

/** @type {ReturnType<typeof setTimeout> | undefined} */
let savedTimer;
function flashSaved() {
  const note = $("#savedNote");
  note.classList.add("show");
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => note.classList.remove("show"), 1200);
}

/**
 * Settings apply as you set them - no Save button to forget. A switch fires `change`
 * on click; a text or number field fires it on blur or Enter, so typing a key does not
 * write a partial value on every keystroke.
 */
function wireAutoSave() {
  for (const input of settingsForm.querySelectorAll("input")) {
    if (input.dataset.wired) continue;
    input.dataset.wired = "1";
    input.addEventListener("change", async () => {
      await window.api.setConfig({ [input.name]: inputValue(input) });
      flashSaved();
    });
  }
}

/** The DOM types allow "until-found" here, so coerce for the toggles below. */
function settingsHidden() {
  return viewSettings.hidden !== false;
}

/** @param {boolean} on */
function showSettings(on) {
  viewSettings.hidden = !on;
  viewUsage.hidden = on;
  if (on) void renderSettings();
}

// Enter in a field commits it (the change event) rather than submitting a form that no
// longer has anything to submit.
settingsForm.addEventListener("submit", (e) => e.preventDefault());

$("#btnDone").addEventListener("click", () => showSettings(false));
$("#btnSettings").addEventListener("click", () => showSettings(settingsHidden()));
$("#btnConfigDir").addEventListener("click", () => void window.api.openConfigDir());
$("#btnRefresh").addEventListener("click", () => void window.api.refresh());

const btnPin = $("#btnPin");
/** aria-pressed is the state itself, not a mirror of it: the CSS reads it too. */
function pinned() {
  return btnPin.getAttribute("aria-pressed") === "true";
}
/** @param {boolean} on @param {boolean} [persist] */
function setPinned(on, persist = true) {
  btnPin.setAttribute("aria-pressed", String(on));
  btnPin.title = on ? "Unpin panel (P)" : "Keep panel open (P)";
  if (persist) void window.api.setPinned(on);
}
btnPin.addEventListener("click", () => setPinned(!pinned()));
// ✕ closes the panel, as it does in every other tray app. Quitting is deliberate: the tray
// menu, or the button in Settings - an accidental quit leaves nothing on screen to explain
// where the app went.
$("#btnClose").addEventListener("click", () => void window.api.hide());
$("#btnQuit").addEventListener("click", () => void window.api.quit());
document.addEventListener("keydown", (e) => {
  if (e.target instanceof HTMLInputElement) return;
  if (e.key === "Escape") void window.api.hide();
  if (e.key === "r" || e.key === "R") void window.api.refresh();
  if (e.key === "s" || e.key === "S") showSettings(settingsHidden());
  if (e.key === "p" || e.key === "P") setPinned(!pinned());
});

window.api.onUsage((s) => {
  state = s;
  renderUsage();
});
void window.api.getUsage().then((s) => {
  state = s;
  renderUsage();
});
// Reflect the stored pin without writing it straight back out again.
void window.api.getConfig().then((cfg) => setPinned(!!cfg.pinned, false));
setInterval(() => {
  if (!viewUsage.hidden) renderUsage();
}, 30_000); // keep "resets in" and "x min ago" fresh
