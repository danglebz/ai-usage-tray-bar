// Types shared by the main process, the providers, the preload bridge and the renderer.
// This file is the contract: a provider returns a Snapshot, the main process turns it into
// a ProviderResult, and the renderer only ever sees UsageState and PublicConfig.

/** How a provider fetch ended. Anything but "ok" carries a `message` for the panel. */
export type Status = "ok" | "not_configured" | "not_logged_in" | "expired" | "error";

/** Bucket used to colour bars and the tray tooltip. */
export type Severity = "normal" | "warning" | "critical" | "unknown";

/** One rolling limit ("5-hour session", "Weekly") or spend bar. `percent` is USED percent. */
export interface UsageWindow {
  label: string;
  /** 0–100 used, one decimal; null when the provider gave no figure. */
  percent: number | null;
  /** ISO timestamp of the next reset; null when the window does not reset (credits, budgets). */
  resetsAt: string | null;
  severity: Severity;
  /** Free-text shown under the bar, e.g. "$1.93 left" or "120 / 300 left". */
  detail?: string;
  /** Claude only: the window the account is currently being throttled on. */
  active?: boolean;
  /** Copilot only: "unlimited" for quotas that are not metered on this plan. */
  note?: string;
}

/** A label/value line under the bars ("Balance: $4.20"). */
export interface Extra {
  label: string;
  value: string;
}

/** What `Provider.fetch` returns. Every constructor in `snap` fills the required fields. */
export interface Snapshot {
  status: Status;
  message?: string;
  /** Plan or tier name when the provider exposes one ("max", "Plus", "free tier"). */
  plan?: string | null;
  /** Account, email or key label — shown in the card head. */
  account?: string | null;
  /** "local" when the figures come from files on disk instead of the provider's API. */
  source?: "api" | "local";
  windows: UsageWindow[];
  extras: Extra[];
  fetchedAt: string;
}

/** A Snapshot stamped with the provider it came from and how long the fetch took. */
export interface ProviderResult extends Snapshot {
  id: string;
  name: string;
  ms: number;
}

/** One text or secret input a provider asks for in Settings. */
export interface ConfigField {
  key: string;
  label: string;
  placeholder?: string;
  help?: string;
  docUrl?: string;
  docLabel?: string;
  /** Masked in the panel and never sent back to the renderer. */
  secret: boolean;
}

/**
 * Per-provider section of config.json. The named keys are the ones current providers declare
 * in `needsConfig`; the index signature is for the ones a new provider adds.
 */
export interface ProviderConfig {
  enabled?: boolean;
  apiKey?: string;
  adminKey?: string;
  githubToken?: string;
  monthlyBudget?: number | string;
  [key: string]: unknown;
}

export interface Provider {
  /** Stable id used as the config key and in notification keys. */
  id: string;
  /** Display name. */
  name: string;
  /** Shown under the provider's heading in Settings. */
  help?: string;
  needsConfig: ConfigField[];
  fetch(config: ProviderConfig): Promise<Snapshot>;
}

/** %APPDATA%/ai-usage-tray/config.json after defaults are merged in. */
export interface AppConfig {
  refreshMinutes: number;
  openAtLogin: boolean;
  /** 0 switches notifications off. */
  notifyAtPercent: number;
  providers: Record<string, ProviderConfig>;
}

/** Everything the renderer needs to draw the Settings view; secrets are masked. */
export interface ProviderMeta {
  id: string;
  name: string;
  help: string | null;
  fields: ConfigField[];
}

export interface PublicConfig extends AppConfig {
  providerMeta: ProviderMeta[];
}

/** A `config:set` payload: dotted config paths to new values, e.g. `{ "providers.openrouter.apiKey": "sk-..." }`. */
export type ConfigPatch = Record<string, string | number | boolean>;

/** The last refresh, as pushed to the panel on the "usage" channel. */
export interface UsageState {
  /** Epoch ms of the last completed refresh; null until the first one finishes. */
  at: number | null;
  refreshing: boolean;
  results: ProviderResult[];
}

/** The bridge preload.cjs exposes as `window.api`. */
export interface Api {
  getUsage(): Promise<UsageState>;
  refresh(): Promise<UsageState>;
  getConfig(): Promise<PublicConfig>;
  setConfig(patch: ConfigPatch): Promise<PublicConfig>;
  quit(): Promise<void>;
  hide(): Promise<void>;
  openConfigDir(): Promise<void>;
  openExternal(url: string): Promise<void>;
  /** Subscribe to refreshes; returns the unsubscribe function. */
  onUsage(cb: (state: UsageState) => void): () => void;
}
