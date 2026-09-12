// Electron main process: tray icon, popup window, refresh loop, IPC.

import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  app,
  BrowserWindow,
  ipcMain,
  Menu,
  nativeImage,
  nativeTheme,
  Notification,
  screen,
  shell,
  Tray,
  type NativeImage,
} from "electron";
import * as config from "./config.ts";
import { demoResults } from "./demo.ts";
import { ringIcon } from "./icon.ts";
import { fetchAll, providers } from "./providers/index.ts";
import type { AppConfig, ConfigPatch, PublicConfig, Severity, UsageState, UsageWindow } from "./types.ts";

const POPUP_W = 400;
const POPUP_H = 620;
// Must match build.appId so packaged and unpackaged runs share one Windows identity.
const AUMID = "local.ai-usage-tray";
const APP_DIR = path.resolve(import.meta.dirname, "..");
// Sample data instead of real providers, and no toasts: for screenshots and panel work.
const DEMO = !!process.env.AI_USAGE_DEMO;

let tray: Tray;
let popup: BrowserWindow;
const cfg: AppConfig = config.load();
let last: UsageState = { at: null, results: [], refreshing: false };
let timer: NodeJS.Timeout | null = null;
let settingsRefreshTimer: NodeJS.Timeout | undefined;
// Windows currently at or above the notify threshold, keyed by provider and label. A toast goes
// out when a window enters this set and the entry is dropped once the window resets below the
// threshold, so a window that stays high through many refreshes is announced once.
const above = new Set<string>();

process.on("unhandledRejection", (e) => console.error("[unhandledRejection]", e instanceof Error ? e.stack : e));
process.on("uncaughtException", (e) => console.error("[uncaughtException]", e.stack ?? e));

// A screenshot run lives for two seconds and must not be swallowed by the instance that is
// already sitting in the tray, so it skips the single-instance lock and keeps its Chromium
// profile apart from the running one's (two processes on one cache directory log errors).
const SCREENSHOT = process.env.AI_USAGE_SCREENSHOT;
if (SCREENSHOT) app.setPath("userData", path.join(app.getPath("temp"), "ai-usage-tray-screenshot"));
if (!SCREENSHOT && !app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", () => showPopup());
  void app.whenReady().then(init);
}

function init(): void {
  app.setAppUserModelId(AUMID);
  registerToastIdentity();
  tray = new Tray(appIcon());
  tray.setToolTip("AI Usage - loading…");
  tray.on("click", () => togglePopup());
  tray.on("right-click", () => tray.popUpContextMenu(buildMenu()));

  createPopup();
  applyLoginItem();
  scheduleRefresh();
  void refresh();
}

function buildMenu(): Menu {
  return Menu.buildFromTemplate([
    { label: "Refresh now", click: () => void refresh() },
    { label: "Open panel", click: () => showPopup() },
    { type: "separator" },
    {
      label: "Start with Windows",
      type: "checkbox",
      checked: !!cfg.openAtLogin,
      click: (item) => {
        cfg.openAtLogin = item.checked;
        config.save(cfg);
        applyLoginItem();
      },
    },
    { label: "Open config folder", click: () => void shell.openPath(config.configDir()) },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
}

/**
 * What launched this app, as a path Windows can launch again. The portable build runs a copy
 * of itself unpacked under %TEMP% and deletes it on exit, so process.execPath would be dead by
 * the next login; electron-builder's stub exports the exe the user actually double-clicked.
 */
function launcher(): string {
  return process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
}

function applyLoginItem(): void {
  // Packaged: the app exe. Dev: electron.exe, which needs the app dir.
  const args = app.isPackaged ? [] : [APP_DIR];
  app.setLoginItemSettings({ openAtLogin: !!cfg.openAtLogin, path: launcher(), args });
}

function createPopup(): void {
  popup = new BrowserWindow({
    width: POPUP_W,
    height: POPUP_H,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    backgroundColor: nativeTheme.shouldUseDarkColors ? "#1c1c1e" : "#ffffff",
    webPreferences: {
      preload: path.join(import.meta.dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  void popup.loadFile(path.join(import.meta.dirname, "renderer", "index.html"));
  popup.on("blur", () => {
    if (!popup.webContents.isDevToolsOpened()) popup.hide();
  });
  popup.on("close", (e) => {
    e.preventDefault();
    popup.hide();
  });
}

function positionPopup(): void {
  const tb = tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y });
  const wa = display.workArea;
  // Taskbar at the bottom (the default): open above the tray icon; otherwise fall back to the corner.
  let x = Math.round(tb.x + tb.width / 2 - POPUP_W / 2);
  let y = tb.y >= wa.y + wa.height ? wa.y + wa.height - POPUP_H - 8 : Math.max(wa.y + 8, tb.y + tb.height + 8);
  x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - POPUP_W - 8));
  y = Math.max(wa.y + 8, Math.min(y, wa.y + wa.height - POPUP_H - 8));
  popup.setBounds({ x, y, width: POPUP_W, height: POPUP_H });
}

function showPopup(): void {
  positionPopup();
  popup.show();
  popup.focus();
  if (!last.at || Date.now() - last.at > 60_000) void refresh();
}

function togglePopup(): void {
  if (popup.isVisible()) popup.hide();
  else showPopup();
}

function scheduleRefresh(): void {
  if (timer) clearInterval(timer);
  const minutes = Math.max(1, Number(cfg.refreshMinutes) || 3);
  timer = setInterval(() => void refresh(), minutes * 60_000);
}

async function refresh(): Promise<void> {
  if (last.refreshing) return;
  last.refreshing = true;
  broadcast();
  try {
    const results = DEMO ? demoResults() : await fetchAll(cfg);
    last = { at: Date.now(), results, refreshing: false };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    last = {
      at: Date.now(),
      refreshing: false,
      results: [
        {
          id: "app",
          name: "App",
          status: "error",
          message,
          windows: [],
          extras: [],
          ms: 0,
          fetchedAt: new Date().toISOString(),
        },
      ],
    };
  }
  updateTray();
  if (!DEMO) notifyThresholds();
  broadcast();
  if (SCREENSHOT && !screenshotDone) void debugScreenshot(SCREENSHOT);
}

// Dev aid: AI_USAGE_SCREENSHOT=out.png pnpm start  → shows the popup, saves it, quits.
// `pnpm screenshot` combines this with AI_USAGE_DEMO for the README images.
let screenshotDone = false;
async function debugScreenshot(file: string): Promise<void> {
  screenshotDone = true;
  showPopup();
  await new Promise((r) => setTimeout(r, 1500));
  if (process.env.AI_USAGE_SCREENSHOT_SETTINGS) {
    await popup.webContents.executeJavaScript("document.querySelector('#btnSettings').click()");
    await new Promise((r) => setTimeout(r, 500));
  }
  const img = await popup.webContents.capturePage();
  fs.writeFileSync(file, img.toPNG());
  app.quit();
}

/** Worst window across all ok providers drives the icon; the tooltip lists one line per provider. */
function updateTray(): void {
  let worst: { percent: number | null; severity: Severity; label: string } = {
    percent: null,
    severity: "unknown",
    label: "",
  };
  const lines: string[] = [];
  for (const r of last.results) {
    if (r.status !== "ok") {
      lines.push(`${r.name}: ${r.status.replace("_", " ")}`);
      continue;
    }
    const parts = r.windows.map((w) => `${w.label} ${w.percent == null ? "?" : Math.round(w.percent) + "%"}`);
    lines.push(`${r.name}: ${parts.join(", ") || r.extras.map((x) => `${x.label} ${x.value}`).join(", ") || "ok"}`);
    for (const w of r.windows) {
      if (w.percent != null && (worst.percent == null || w.percent > worst.percent)) {
        worst = { percent: w.percent, severity: w.severity, label: `${r.name} · ${w.label}` };
      }
    }
  }
  // Keep the app mark stable in the Windows tray; usage remains available in the tooltip
  // and the popup rather than changing the brand icon into a progress ring.
  tray.setImage(appIcon());
  const head = worst.percent == null ? "AI Usage" : `AI Usage - ${Math.round(worst.percent)}% ${worst.label}`;
  tray.setToolTip([head, ...lines].join("\n").slice(0, 127)); // Windows tooltips cap at 128 chars
}

/**
 * Windows looks up a toast's header name and icon by AppUserModelID through a Start Menu
 * shortcut that carries the ID as System.AppUserModel.ID - something an installer would
 * normally create. This app runs unpackaged (Smart App Control blocks the built exe), so it
 * keeps that shortcut itself, aimed at whatever launched it, the same target the login item
 * uses. It is rewritten whenever it does not match, not only when missing: a shortcut with
 * this ID once pointed at an exe under %TEMP% (the portable build's self-extract folder) that
 * no longer existed, and every toast kept showing that dead exe's cached icon.
 *
 * The registry entry under HKCU\Software\Classes\AppUserModelId is what Windows consults
 * when no shortcut matches, so it carries the same name and icon. IconUri only affects the
 * small identity icon beside the app name; the toast body itself stays text-only (no `icon`
 * is passed to Notification).
 *
 * Best-effort: a failure here only costs the icon, so it never interrupts startup.
 */
function registerToastIdentity(): void {
  if (process.platform !== "win32") return;
  try {
    // Both the shortcut and IconUri must point at real files on disk - nothing inside app.asar
    // is readable by the shell. The packaged exe embeds the icon; unpackaged, electron.exe
    // carries Electron's own, so use the .ico from the source tree and a PNG copy in userData.
    // config.configDir(), not app.getPath("userData"): that one is derived from the product
    // name and would move if the name ever changed, leaving a stale path in the registry.
    const iconFile = path.join(config.configDir(), "toast-icon.png");
    const png = appIcon().toPNG();
    if (!fs.existsSync(iconFile) || fs.statSync(iconFile).size !== png.length) {
      fs.mkdirSync(path.dirname(iconFile), { recursive: true });
      fs.writeFileSync(iconFile, png);
    }

    const want: Electron.ShortcutDetails = {
      target: launcher(),
      args: app.isPackaged ? "" : `"${APP_DIR}"`,
      icon: app.isPackaged ? launcher() : path.join(APP_DIR, "assets", "icon.ico"),
      iconIndex: 0,
      appUserModelId: AUMID,
      description: app.getName(),
    };
    const lnk = path.join(
      app.getPath("appData"),
      "Microsoft",
      "Windows",
      "Start Menu",
      "Programs",
      `${app.getName()}.lnk`,
    );
    let have: Electron.ShortcutDetails | null = null;
    try {
      have = shell.readShortcutLink(lnk);
    } catch {
      /* missing or unreadable: written below */
    }
    const current = have;
    const stale =
      !current || (["target", "args", "icon", "appUserModelId"] as const).some((k) => current[k] !== want[k]);
    if (stale && !shell.writeShortcutLink(lnk, "create", want) && process.env.AI_USAGE_DEBUG) {
      console.log(`[toast] could not write ${lnk}`);
    }

    const key = `HKCU\\Software\\Classes\\AppUserModelId\\${AUMID}`;
    for (const [name, value] of [
      ["DisplayName", app.getName()],
      ["IconUri", iconFile],
    ]) {
      execFile("reg", ["add", key, "/v", name, "/t", "REG_SZ", "/d", value, "/f"], () => {});
    }
  } catch {
    /* the toast still works, just with the stock icon */
  }
}

/** The app's own icon, loaded once. Resolves inside app.asar as well as from the source tree. */
let cachedIcon: NativeImage | null = null;
function appIcon(): NativeImage {
  if (cachedIcon) return cachedIcon;
  const img = nativeImage.createFromPath(path.join(APP_DIR, "assets", "icon.png"));
  cachedIcon = img.isEmpty() ? ringIcon(65, "warning") : img;
  return cachedIcon;
}

/** "in 1h 29m" / "in 3d" — shorter and locale-proof next to a Thai Buddhist-era date string. */
function untilText(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "resetting now";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h >= 48) return `resets in ${Math.round(h / 24)}d`;
  if (h >= 1) return `resets in ${h}h ${m}m`;
  return `resets in ${m}m`;
}

/** A window with a figure, tagged with the provider it belongs to. */
interface Crossed extends UsageWindow {
  provider: string;
  percent: number;
}

/**
 * One notification per refresh, not one per window: several limits usually cross together
 * (a 5-hour and a weekly window fill up at the same time) and Windows stacks each as its
 * own toast. Everything newly crossed goes into a single toast; clicking it opens the panel.
 *
 * "Newly crossed" is judged against the previous refresh, not against the reset time: Anthropic
 * stamps resets_at with a fresh sub-second fraction on every call (08:00:00.888, 08:00:00.323,
 * 07:59:59.772 for the same window), so a key built from it never repeats and the same toast
 * would come back every refresh until the window reset.
 */
function notifyThresholds(): void {
  const threshold = Number(cfg.notifyAtPercent) || 0;
  if (!threshold || !Notification.isSupported()) {
    above.clear(); // switched off: nothing is tracked, so switching back on starts fresh like a first launch
    return;
  }

  // Highest figure per provider and label this refresh. A provider can in principle emit two
  // windows under one label (Claude falls back to "Weekly (scoped)", Codex to "Window"), and
  // judging them one at a time would let the lower one re-arm the key on every refresh.
  const seen = new Map<string, Crossed>();
  for (const r of last.results) {
    if (r.status !== "ok") continue;
    for (const w of r.windows) {
      if (w.percent == null) continue;
      const key = `${r.id}|${w.label}`;
      const prev = seen.get(key);
      if (!prev || w.percent > prev.percent) seen.set(key, { ...w, percent: w.percent, provider: r.name });
    }
  }

  const crossed: Crossed[] = [];
  for (const [key, c] of seen) {
    if (c.percent < threshold) {
      above.delete(key); // the window reset, or the threshold was raised past it: arm again
      continue;
    }
    if (above.has(key)) continue;
    above.add(key);
    // A window that is already full is not a warning, it is a fact the user runs into on the
    // next request anyway - there is nothing left to save. Judged on the rounded figure so
    // that a toast never reads "at 100%". Unless 100 is the threshold itself: then "full" is
    // exactly what was asked for.
    if (threshold < 100 && Math.round(c.percent) >= 100) continue;
    crossed.push(c);
  }
  const first = crossed[0];
  if (!first) return;

  crossed.sort((a, b) => b.percent - a.percent);
  const line = (c: Crossed) =>
    `${c.provider} · ${c.label} ${Math.round(c.percent)}%${c.resetsAt ? ` · ${untilText(c.resetsAt)}` : ""}`;
  const title =
    crossed.length === 1
      ? `${first.provider}: ${first.label} at ${Math.round(first.percent)}%`
      : `${crossed.length} limits at ${threshold}% or above`;
  const body = crossed.length === 1 ? untilText(first.resetsAt) : crossed.map(line).join("\n");

  if (process.env.AI_USAGE_DEBUG) console.log(`[notify] ${title}\n${body}`);
  // Do not set `icon`: the notification content stays text-first, without the large
  // app-logo image shown by previous versions.
  const n = new Notification({ title, body });
  n.on("click", () => showPopup());
  n.show();
}

function broadcast(): void {
  if (popup && !popup.isDestroyed()) popup.webContents.send("usage", publicState());
}

function publicState(): UsageState {
  return { at: last.at, refreshing: last.refreshing, results: last.results };
}

/** Config for the renderer: secrets replaced by a boolean so they never cross the bridge. */
function publicConfig(): PublicConfig {
  const out: AppConfig = structuredClone(cfg);
  for (const p of providers) {
    const pc = out.providers[p.id] ?? {};
    for (const f of p.needsConfig) {
      if (f.secret) pc[f.key] = pc[f.key] ? "••••••••" : "";
    }
  }
  const providerMeta = providers.map((p) => ({ id: p.id, name: p.name, help: p.help ?? null, fields: p.needsConfig }));
  return { ...out, providerMeta };
}

ipcMain.handle("usage:get", () => publicState());
ipcMain.handle("usage:refresh", async () => {
  await refresh();
  return publicState();
});
ipcMain.handle("config:get", () => publicConfig());
ipcMain.handle("config:set", (_e, patch: ConfigPatch) => {
  // patch: { "refreshMinutes": 5, "providers.openrouter.apiKey": "sk-..." }
  for (const [k, v] of Object.entries(patch ?? {})) {
    if (v === "••••••••") continue; // untouched masked secret
    config.set(cfg, k, v);
  }
  config.save(cfg);
  scheduleRefresh();
  applyLoginItem();
  // Settings now save per field, so flipping three switches would otherwise fire three
  // fetches at the providers. Coalesce them into one.
  clearTimeout(settingsRefreshTimer);
  settingsRefreshTimer = setTimeout(() => void refresh(), 400);
  return publicConfig();
});
ipcMain.handle("app:quit", () => app.quit());
ipcMain.handle("app:openConfigDir", () => shell.openPath(config.configDir()));
ipcMain.handle("app:openExternal", (_e, url: string) => {
  if (/^https:\/\//.test(url)) void shell.openExternal(url);
});
ipcMain.handle("app:hide", () => popup.hide());

// Subscribing is what keeps the app alive without windows; the popup only ever hides anyway.
app.on("window-all-closed", () => {});
app.on("before-quit", () => {
  if (popup) popup.removeAllListeners("close");
});
