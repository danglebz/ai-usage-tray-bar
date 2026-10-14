// User config lives at %APPDATA%/ai-usage-tray/config.json (Electron's userData dir when
// running inside Electron, the same path when run from the CLI). API keys are stored in
// plain text there, like every other CLI on this machine does - keep the file private.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { AppConfig } from "./types.ts";

export const DEFAULTS: AppConfig = {
  refreshMinutes: 3,
  openAtLogin: false,
  notifyAtPercent: 90,
  pinned: false,
  providers: {
    claude: { enabled: true },
    codex: { enabled: true },
    copilot: { enabled: true },
    gemini: { enabled: true },
    openrouter: { enabled: true },
    "anthropic-api": { enabled: true },
    "openai-api": { enabled: true },
  },
};

export function configDir(): string {
  const appData = process.env.APPDATA || path.join(os.homedir(), "AppData", "Roaming");
  return path.join(appData, "ai-usage-tray");
}

export function configPath(): string {
  return path.join(configDir(), "config.json");
}

type Plain = Record<string, unknown>;

function isPlain(v: unknown): v is Plain {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Deep-merge `over` into `base`; objects recurse, everything else (arrays included) is replaced. */
export function merge<T extends object>(base: T, over: unknown): T {
  const out: Plain = { ...(base as Plain) };
  if (isPlain(over)) {
    for (const [k, v] of Object.entries(over)) {
      const b = out[k];
      out[k] = isPlain(v) ? merge(isPlain(b) ? b : {}, v) : v;
    }
  }
  return out as T;
}

export function load(): AppConfig {
  let user: unknown = {};
  try {
    user = JSON.parse(fs.readFileSync(configPath(), "utf8"));
  } catch {
    /* first run */
  }
  return merge(DEFAULTS, user);
}

export function save(cfg: AppConfig): AppConfig {
  fs.mkdirSync(configDir(), { recursive: true });
  const tmp = configPath() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, configPath());
  return cfg;
}

/** Deep-set a value using a dotted path like "providers.openrouter.apiKey". */
export function set(cfg: AppConfig, dotted: string, value: unknown): AppConfig {
  const keys = dotted.split(".");
  const last = keys.pop() as string;
  let cur: Plain = cfg as unknown as Plain;
  for (const k of keys) {
    const next = cur[k];
    if (!isPlain(next)) cur[k] = {};
    cur = cur[k] as Plain;
  }
  cur[last] = value;
  return cfg;
}
