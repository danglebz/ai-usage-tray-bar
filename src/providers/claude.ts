// Claude Code (claude.ai subscription: Pro / Max / Team).
//
// Reads the OAuth token Claude Code already stores and asks the same endpoint that
// `/usage` inside Claude Code asks. The endpoint is not documented; the field names
// below were taken from the installed claude.exe (2.1.215) and a live 200 response.
//
// This provider NEVER refreshes the token. Refresh tokens may be single-use, and
// refreshing here could log Claude Code itself out. When the token has expired we
// show the local-log summary and ask the user to open Claude Code once.

import type { Extra, Provider, Snapshot, UsageWindow } from "../types.ts";
import { extra, fetchJson, home, isObject, num, prop, readJson, snap, str, usd, win } from "./_util.ts";
import { summarize } from "./claude-local.ts";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

const KIND_LABEL: Record<string, string> = {
  session: "5-hour session",
  weekly_all: "Weekly (all models)",
};

interface Credentials {
  accessToken: string | null;
  subscriptionType: string | null;
  expiresAt: number | null;
}

function readCredentials(): Credentials | null {
  const oauth = prop(readJson(home(".claude", ".credentials.json")), "claudeAiOauth");
  if (!isObject(oauth)) return null;
  return {
    accessToken: str(oauth.accessToken),
    subscriptionType: str(oauth.subscriptionType),
    expiresAt: num(oauth.expiresAt),
  };
}

function fmtTokens(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${Math.round(n / 1e3)}k` : String(n);
}

function localExtras(): Extra[] {
  try {
    const s = summarize();
    return [
      extra("Local 5h", `${fmtTokens(s.h5.tokens)} tok · ~${usd(s.h5.cost)}`),
      extra("Local 7d", `${fmtTokens(s.d7.tokens)} tok · ~${usd(s.d7.cost)}`),
    ];
  } catch {
    return [];
  }
}

function windowsFrom(json: Record<string, unknown>): UsageWindow[] {
  const out: UsageWindow[] = [];
  if (Array.isArray(json.limits) && json.limits.length) {
    for (const l of json.limits as unknown[]) {
      const kind = str(prop(l, "kind"));
      let label = kind ? KIND_LABEL[kind] : undefined;
      if (!label && kind === "weekly_scoped") {
        const model = str(prop(prop(prop(l, "scope"), "model"), "display_name"));
        label = model ? `Weekly (${model})` : "Weekly (scoped)";
      }
      if (!label) label = kind ?? "Limit";
      out.push(win(label, prop(l, "percent"), prop(l, "resets_at"), { active: !!prop(l, "is_active") }));
    }
    return out;
  }
  // Older shape: top-level five_hour / seven_day objects.
  const legacy = (key: string, label: string): void => {
    const w = json[key];
    if (isObject(w)) out.push(win(label, w.utilization, w.resets_at));
  };
  legacy("five_hour", "5-hour session");
  legacy("seven_day", "Weekly (all models)");
  legacy("seven_day_opus", "Weekly (opus)");
  legacy("seven_day_sonnet", "Weekly (sonnet)");
  return out;
}

async function fetchUsage(): Promise<Snapshot> {
  const cred = readCredentials();
  if (!cred?.accessToken) {
    return snap.notLoggedIn("Claude Code is not logged in on this machine (no ~/.claude/.credentials.json).");
  }
  const plan = cred.subscriptionType;
  const expired = cred.expiresAt != null && cred.expiresAt < Date.now();
  if (expired) {
    return snap.expired("Access token expired. Open Claude Code once and it will refresh itself.", {
      plan,
      extras: localExtras(),
      source: "local",
    });
  }

  const fallback = () => ({ plan, extras: localExtras(), source: "local" as const });
  let res;
  try {
    res = await fetchJson(USAGE_URL, {
      headers: { Authorization: `Bearer ${cred.accessToken}`, "anthropic-beta": "oauth-2025-04-20" },
    });
  } catch (e) {
    return snap.error(`Network error: ${(e as Error).message}`, fallback());
  }
  if (res.status === 401 || res.status === 403) {
    return snap.expired(
      `Anthropic rejected the token (HTTP ${res.status}). Open Claude Code once to refresh it.`,
      fallback(),
    );
  }
  if (!res.ok || !isObject(res.json)) {
    return snap.error(`HTTP ${res.status} from usage endpoint`, fallback());
  }

  const extras: Extra[] = [];
  const xu = res.json.extra_usage;
  if (isObject(xu) && xu.is_enabled) {
    const value = `${num(xu.utilization) ?? 0}% of ${xu.monthly_limit ?? "?"} ${str(xu.currency) ?? ""}`.trim();
    extras.push(extra("Extra usage", value));
  }
  extras.push(...localExtras());

  return snap.ok({ plan, windows: windowsFrom(res.json), extras });
}

const provider: Provider = {
  id: "claude",
  name: "Claude Code",
  fetch: fetchUsage,
  help: "Nothing to enter - reads the login Claude Code already made. If it says expired, open Claude Code once.",
  needsConfig: [],
};

export default provider;
