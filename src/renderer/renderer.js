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

function renderUsage() {
  viewUsage.replaceChildren();
  if (!state.results.length) {
    viewUsage.append(el("div", { class: "empty", text: state.refreshing ? "Loading…" : "No providers enabled." }));
  }
  /** @type {Severity} */
  let worst = "unknown";
  for (const r of state.results) {
    const tone = r.status === "ok" ? "" : r.status === "error" || r.status === "expired" ? "err" : "idle";
    const card = el("div", { class: `card ${tone}` });
    const head = el("div", { class: "head" }, el("span", { class: "name", text: r.name }));
    if (r.plan) head.append(el("span", { class: "plan", text: r.plan }));
    if (r.source === "local") head.append(el("span", { class: "badge", text: "local" }));
    if (r.account) head.append(el("span", { class: "acct", text: r.account, title: r.account }));
    card.append(head);

    if (r.status !== "ok") {
      card.append(el("div", { class: "status", text: `${STATUS_TEXT[r.status] ?? r.status}: ${r.message ?? ""}` }));
    } else if (r.message) {
      card.append(el("div", { class: "status", text: r.message }));
    }

    for (const w of r.windows) {
      if (RANK[w.severity] > RANK[worst]) worst = w.severity;
      const pctText = w.percent == null ? "?" : `${Math.round(w.percent)}%`;
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
        el("div", { class: `bar ${w.severity}` }, el("i", { style: { width: `${w.percent ?? 0}%` } })),
      );
      if (w.detail) row.append(el("div", { class: "detail", text: w.detail }));
      card.append(row);
    }

    if (r.extras.length) {
      const ex = el("div", { class: "extras" });
      for (const x of r.extras) ex.append(el("span", {}, `${x.label}: `, el("b", { text: x.value })));
      card.append(ex);
    }
    viewUsage.append(card);
  }
  $("#headDot").className = `dot ${worst}`;
  $("#stamp").textContent = state.refreshing ? "refreshing…" : relStamp(state.at);
  $("#btnRefresh").classList.toggle("spin", !!state.refreshing);
}

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
    const sec = el("section", {}, el("label", { class: "secHead" }, el("h2", { text: p.name }), toggle));
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
