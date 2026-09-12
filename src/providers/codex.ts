// OpenAI Codex CLI (ChatGPT Plus / Pro / Team plan).
//
// Reads ~/.codex/auth.json (or $CODEX_HOME/auth.json) and asks the endpoint the Codex
// TUI polls every 60s. Paths, headers and field names come from openai/codex
// codex-rs/backend-client (rate_limit_resets.rs, openapi-models). Not documented by
// OpenAI; may change without notice.
//
// Fallback when the API fails: the newest session log under ~/.codex/sessions carries
// `rate_limits` on every token_count event (codex-rs/protocol RateLimitSnapshot).
//
// Verified 2026-09-12 against a live 200 response on a free ChatGPT plan: that plan has a
// single 30-day primary_window and a null secondary_window, so a Plus/Pro account's 5-hour
// and weekly pair has still not been seen here. credits/additional_rate_limits were null.

import fs from "node:fs";
import path from "node:path";
import type { Extra, Provider, Snapshot, UsageWindow } from "../types.ts";
import {
  decodeJwt,
  extra,
  fetchJson,
  home,
  isObject,
  num,
  prop,
  readJsonObject,
  snap,
  str,
  walkFiles,
  win,
  windowLabel,
} from "./_util.ts";

const USAGE_URL = "https://chatgpt.com/backend-api/wham/usage";

function codexHome(): string {
  return process.env.CODEX_HOME || home(".codex");
}

interface Auth {
  apiKey: string | null;
  accessToken: string | null;
  accountId: string | null;
  plan: string | null;
  email: string | null;
  /** Unix seconds when the access token expires, when its JWT says. */
  accessExp: number | null;
}

function readAuth(): Auth | null {
  const auth = readJsonObject(path.join(codexHome(), "auth.json"));
  if (!auth) return null;
  const tokens = isObject(auth.tokens) ? auth.tokens : {};
  const claims = decodeJwt(tokens.id_token) ?? {};
  const authClaim = claims["https://api.openai.com/auth"];
  const profile = claims["https://api.openai.com/profile"];
  return {
    apiKey: str(auth.OPENAI_API_KEY),
    accessToken: str(tokens.access_token),
    accountId: str(tokens.account_id) ?? str(prop(authClaim, "chatgpt_account_id")),
    plan: str(prop(authClaim, "chatgpt_plan_type")),
    email: str(prop(profile, "email")) ?? str(claims.email),
    accessExp: num(prop(decodeJwt(tokens.access_token), "exp")),
  };
}

function windowFrom(label: string | null, w: unknown): UsageWindow | null {
  if (!isObject(w)) return null;
  return win(label ?? windowLabel(num(w.limit_window_seconds)), w.used_percent, w.reset_at);
}

function windowsFrom(json: Record<string, unknown>): UsageWindow[] {
  const out: UsageWindow[] = [];
  const rl = json.rate_limit;
  const p = windowFrom(null, prop(rl, "primary_window"));
  const s = windowFrom(null, prop(rl, "secondary_window"));
  if (p) out.push(p);
  if (s) out.push(s);
  const additional = Array.isArray(json.additional_rate_limits) ? (json.additional_rate_limits as unknown[]) : [];
  for (const a of additional) {
    const arl = prop(a, "rate_limit");
    const label = str(prop(a, "limit_name")) ?? str(prop(a, "metered_feature"));
    const w = windowFrom(label, prop(arl, "primary_window") ?? prop(arl, "secondary_window"));
    if (w) out.push(w);
  }
  return out;
}

interface LocalSnapshot {
  windows: UsageWindow[];
  plan: string | null;
  at: string | null;
}

/** Newest rate_limits snapshot from local session logs (last 7 days). */
function localSnapshot(): LocalSnapshot | null {
  const root = path.join(codexHome(), "sessions");
  const since = Date.now() - 7 * 24 * 3600 * 1000;
  const files = walkFiles(root, (p) => p.endsWith(".jsonl"))
    .filter((f) => f.mtimeMs >= since)
    .slice(0, 5);
  for (const f of files) {
    let text: string;
    try {
      text = fs.readFileSync(f.path, "utf8");
    } catch {
      continue;
    }
    const lines = text.split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      const line = lines[i] as string;
      if (!line.includes("rate_limits")) continue;
      try {
        const j: unknown = JSON.parse(line);
        const rl = prop(prop(j, "payload"), "rate_limits") ?? prop(j, "rate_limits");
        if (!isObject(rl)) continue;
        const windows: UsageWindow[] = [];
        for (const w of [rl.primary, rl.secondary]) {
          if (!isObject(w)) continue;
          const minutes = num(w.window_minutes);
          windows.push(win(windowLabel(minutes ? minutes * 60 : null), w.used_percent, w.resets_at));
        }
        if (windows.length) return { windows, plan: str(rl.plan_type), at: str(prop(j, "timestamp")) };
      } catch {
        /* keep scanning */
      }
    }
  }
  return null;
}

async function fetchUsage(): Promise<Snapshot> {
  const auth = readAuth();
  if (!auth) {
    return snap.notLoggedIn("Codex is not logged in on this machine (no ~/.codex/auth.json). Run `codex` and sign in.");
  }
  if (!auth.accessToken) {
    return auth.apiKey
      ? snap.notConfigured(
          "Codex is using an API key, which has no plan rate limits. Sign in with ChatGPT to see them.",
        )
      : snap.notLoggedIn("auth.json has no ChatGPT tokens. Run `codex login`.");
  }

  const base = { plan: auth.plan, account: auth.email };
  const fallback = () => {
    const l = localSnapshot();
    return l
      ? {
          ...base,
          windows: l.windows,
          source: "local" as const,
          plan: base.plan ?? l.plan,
          extras: [extra("From session log", l.at ?? "unknown time")],
        }
      : base;
  };

  if (auth.accessExp && auth.accessExp * 1000 < Date.now()) {
    return snap.expired("Codex access token expired. Run `codex` once so it refreshes.", fallback());
  }

  let res;
  try {
    res = await fetchJson(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${auth.accessToken}`,
        ...(auth.accountId ? { "ChatGPT-Account-Id": auth.accountId } : {}),
        "User-Agent": "codex-cli",
      },
    });
  } catch (e) {
    return snap.error(`Network error: ${(e as Error).message}`, fallback());
  }
  if (res.status === 401 || res.status === 403) {
    return snap.expired(`ChatGPT rejected the token (HTTP ${res.status}). Run \`codex\` once to refresh.`, fallback());
  }
  if (!res.ok || !isObject(res.json)) return snap.error(`HTTP ${res.status} from usage endpoint`, fallback());

  const j = res.json;
  const extras: Extra[] = [];
  const credits = j.credits;
  if (isObject(credits) && credits.has_credits) {
    extras.push(extra("Credits", credits.unlimited ? "unlimited" : String(credits.balance ?? "?")));
  }
  if (prop(j.rate_limit, "limit_reached")) extras.push(extra("Status", "limit reached"));

  return snap.ok({ plan: str(j.plan_type) ?? base.plan, account: base.account, windows: windowsFrom(j), extras });
}

const provider: Provider = {
  id: "codex",
  name: "Codex",
  fetch: fetchUsage,
  help: "Nothing to enter - reads the login Codex CLI already made. Run `codex` and sign in with ChatGPT.",
  needsConfig: [],
};

export default provider;
