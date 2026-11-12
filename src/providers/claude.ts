// Claude Code (claude.ai subscription: Pro / Max / Team / Ultra).
//
// Reads the OAuth token Claude Code already stores and asks the same endpoint that
// `/usage` inside Claude Code asks. The endpoint is not documented. Where the fields
// come from, last verified 2026-11-13:
//   - A live 200 response on a Max 20x plan: `limits[]` rows (kind, group, percent,
//     severity, resets_at, scope, is_active) next to the legacy five_hour / seven_day
//     objects, and `rateLimitTier` ("default_claude_max_20x") in the credentials file.
//   - The rate_limits contract documented inside the installed Claude Code 2.1.310. Rows
//     are classified on `kind`, never on a label; the server's order, `severity` and
//     `is_active` are used as sent; `limits` is [] when the server reported no meters and
//     null when the body carried no rows at all (a server that predates them).
// No Ultra (or other no-5-hour-limit) response was available to test against; those plans
// are handled from the documented contract only. Tested live on Max 20x only.
//
// This provider NEVER refreshes the token. Refresh tokens may be single-use, and
// refreshing here could log Claude Code itself out. When the token has expired we
// show the local-log summary and ask the user to open Claude Code once.

import type { Extra, Provider, Severity, Snapshot, UsageWindow } from "../types.ts";
import { extra, fetchJson, home, isObject, num, prop, readJson, snap, str, usd, win } from "./_util.ts";
import { summarize } from "./claude-local.ts";

const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";

const KIND_LABEL: Record<string, string> = {
  session: "5-hour session",
  weekly_all: "Weekly (all models)",
};

const GROUP_LABEL: Record<string, string> = {
  session: "Session",
  weekly: "Weekly",
};

const NO_LIMITS_MESSAGE = "No usage limits reported for this plan.";

interface Credentials {
  accessToken: string | null;
  subscriptionType: string | null;
  rateLimitTier: string | null;
  expiresAt: number | null;
}

function readCredentials(): Credentials | null {
  const oauth = prop(readJson(home(".claude", ".credentials.json")), "claudeAiOauth");
  if (!isObject(oauth)) return null;
  return {
    accessToken: str(oauth.accessToken),
    subscriptionType: str(oauth.subscriptionType),
    rateLimitTier: str(oauth.rateLimitTier),
    expiresAt: num(oauth.expiresAt),
  };
}

/** "weekly_ultra" -> "Weekly ultra". */
function humanize(s: string): string {
  const t = s.replace(/_/g, " ").trim();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/**
 * Card-head plan name from the credentials: "max" + "default_claude_max_20x" -> "Max 20x";
 * any other non-empty type has its first letter capitalised ("ultra" -> "Ultra"); null when
 * Claude Code stored no type.
 */
export function planLabel(subscriptionType: string | null, rateLimitTier: string | null): string | null {
  const type = subscriptionType?.trim();
  if (!type) return null;
  if (type.toLowerCase() === "max") {
    const m = /max_(\d+)x$/.exec(rateLimitTier ?? "");
    if (m) return `Max ${m[1]}x`;
  }
  return type.charAt(0).toUpperCase() + type.slice(1);
}

/** The server's own reading of a row, or null when it sent none we recognise. */
function serverSeverity(v: unknown): Severity | null {
  return v === "normal" || v === "warning" || v === "critical" ? v : null;
}

/** Label for one `limits[]` row. Classified on kind / group / scope, never on the server's text. */
function limitLabel(row: Record<string, unknown>): string {
  const kind = str(prop(row, "kind"));
  if (kind && KIND_LABEL[kind]) return KIND_LABEL[kind];

  const scope = prop(row, "scope");
  const scoped = [prop(prop(scope, "model"), "display_name"), prop(prop(scope, "surface"), "display_name")]
    .map(str)
    .filter((n): n is string => !!n);
  if (scoped.length) {
    const group = str(prop(row, "group")) ?? kind?.split("_")[0];
    const head = group ? (GROUP_LABEL[group] ?? humanize(group)) : "Limit";
    return `${head} (${scoped.join(", ")})`;
  }
  return kind ? humanize(kind) : "Limit";
}

/**
 * Turn the usage body into card windows. An array `limits` (even an empty one) is used
 * verbatim, in the server's order, and the legacy keys are ignored. Only when `limits` is
 * null or absent do we fall back to the older top-level five_hour / seven_day objects.
 */
export function windowsFrom(json: Record<string, unknown>): UsageWindow[] {
  const out: UsageWindow[] = [];
  if (Array.isArray(json.limits)) {
    for (const row of json.limits) {
      if (!isObject(row)) continue;
      const w = win(limitLabel(row), row.percent, row.resets_at, { active: !!row.is_active });
      out.push({ ...w, severity: serverSeverity(row.severity) ?? w.severity });
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

async function fetchUsage(): Promise<Snapshot> {
  const cred = readCredentials();
  if (!cred?.accessToken) {
    return snap.notLoggedIn("Claude Code is not logged in on this machine (no ~/.claude/.credentials.json).");
  }
  const plan = planLabel(cred.subscriptionType, cred.rateLimitTier);
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

  // The server sent a meter list (not null) that yields no usable row, e.g. [] or [null]:
  // this plan has no limits to show, so say so instead of leaving an empty card.
  const windows = windowsFrom(res.json);
  if (Array.isArray(res.json.limits) && windows.length === 0) {
    return snap.ok({ plan, windows, message: NO_LIMITS_MESSAGE, extras });
  }
  return snap.ok({ plan, windows, extras });
}

const provider: Provider = {
  id: "claude",
  name: "Claude Code",
  fetch: fetchUsage,
  help: "Nothing to enter - reads the login Claude Code already made. If it says expired, open Claude Code once.",
  needsConfig: [],
};

export default provider;
