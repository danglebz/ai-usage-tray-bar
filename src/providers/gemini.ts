// Gemini CLI (Google Code Assist quota).
//
// Reads ~/.gemini/oauth_creds.json and calls the private Code Assist quota API that the
// CLI itself uses (per CodexBar docs/gemini.md). No token refresh: that would need the
// CLI's OAuth client secret. When the token is stale, run `gemini` once.
//
// Google stopped serving this OAuth path for individual / AI Pro / Ultra accounts on
// 2026-06-18; Workspace, Standard and Enterprise accounts still work. A 403 with
// SUBSCRIPTION_REQUIRED is reported as such rather than as a bug.
// UNTESTED on the author's machine (no Gemini CLI login there).

import type { Provider, Snapshot } from "../types.ts";
import { decodeJwt, extra, fetchJson, home, isObject, num, prop, readJsonObject, snap, str, win } from "./_util.ts";
import type { FetchResult } from "./_util.ts";

const BASE = "https://cloudcode-pa.googleapis.com/v1internal";

async function post(method: string, token: string, body: unknown): Promise<FetchResult> {
  return fetchJson(`${BASE}:${method}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

interface Best {
  used: number | null;
  reset: unknown;
  model: string;
}

async function fetchUsage(): Promise<Snapshot> {
  const settings = readJsonObject(home(".gemini", "settings.json")) ?? {};
  const authType = str(prop(prop(settings.security, "auth"), "selectedType")) ?? str(settings.selectedAuthType);
  if (authType && authType !== "oauth-personal") {
    // Only the Code Assist OAuth path exposes a quota API. An API key bills per request
    // against the Gemini API and has no "remaining" figure to read anywhere.
    const how =
      authType === "gemini-api-key" || authType === "api-key"
        ? "API-key auth bills per request and publishes no remaining-quota figure. Run /auth in the CLI and pick Login with Google to see quota here."
        : `Quota is only published for Google login (oauth-personal).`;
    return snap.notConfigured(`Gemini CLI is set to "${authType}". ${how}`);
  }
  const creds = readJsonObject(home(".gemini", "oauth_creds.json"));
  const accessToken = str(creds?.access_token);
  if (!creds || !accessToken) {
    return snap.notLoggedIn("Gemini CLI is not logged in (no ~/.gemini/oauth_creds.json). Run `gemini` and sign in.");
  }
  const claims = decodeJwt(creds.id_token) ?? {};
  const base = { account: str(claims.email) };
  const expiry = num(creds.expiry_date);
  if (expiry != null && expiry < Date.now()) {
    return snap.expired("Gemini access token expired. Run `gemini` once so it refreshes.", base);
  }

  let tier: string | null = null;
  let project: string | null = null;
  try {
    const lc = await post("loadCodeAssist", accessToken, { metadata: { ideType: "GEMINI_CLI", pluginType: "GEMINI" } });
    if (lc.status === 401) return snap.expired("Google rejected the token (401). Run `gemini` once to refresh.", base);
    if (isObject(lc.json)) {
      project = str(lc.json.cloudaicompanionProject);
      const cur = lc.json.currentTier;
      tier = str(prop(lc.json.paidTier, "name")) ?? str(prop(cur, "name")) ?? str(prop(cur, "id"));
      const ineligible = Array.isArray(lc.json.ineligibleTiers) ? (lc.json.ineligibleTiers as unknown[]) : [];
      const unsupported = ineligible.find((t) => prop(t, "reasonCode") === "UNSUPPORTED_CLIENT");
      if (!cur && unsupported) {
        return snap.notConfigured(
          "Google no longer serves Gemini CLI quota for individual / AI Pro / Ultra accounts (since 2026-06-18).",
          base,
        );
      }
    }
  } catch (e) {
    return snap.error(`Network error: ${(e as Error).message}`, base);
  }

  let q: FetchResult;
  try {
    q = await post("retrieveUserQuota", accessToken, project ? { project } : {});
  } catch (e) {
    return snap.error(`Network error: ${(e as Error).message}`, base);
  }
  if (q.status === 401) return snap.expired("Google rejected the token (401). Run `gemini` once to refresh.", base);
  if (q.status === 403) {
    const reason = str(prop(prop(q.json, "error"), "status")) ?? "forbidden";
    return snap.notConfigured(`Quota API returned 403 (${reason}) - account tier not eligible.`, base);
  }
  if (!q.ok || !isObject(q.json)) return snap.error(`HTTP ${q.status} from retrieveUserQuota`, base);

  // Buckets: { modelId, remainingFraction, resetTime }. Lowest remaining per model family wins.
  const raw = q.json.buckets ?? q.json.quotaBuckets ?? q.json.userQuota;
  const buckets: unknown[] = Array.isArray(raw) ? raw : [];
  const best: Record<string, Best> = {};
  for (const b of buckets) {
    const model = String(prop(b, "modelId") ?? prop(b, "model") ?? "unknown");
    const family = /flash/i.test(model) ? "Flash" : /pro/i.test(model) ? "Pro" : model;
    const remaining = num(prop(b, "remainingFraction"));
    const used = remaining == null ? null : (1 - remaining) * 100;
    const cur = best[family];
    if (!cur || (used != null && (cur.used == null || used > cur.used))) {
      best[family] = { used, reset: prop(b, "resetTime") ?? null, model };
    }
  }
  const windows = Object.entries(best).map(([family, v]) =>
    win(`${family} models`, v.used, v.reset, { detail: v.model }),
  );
  if (!windows.length) return snap.error("Quota response had no buckets", base);

  return snap.ok({ ...base, plan: tier, windows, extras: project ? [extra("Project", project)] : [] });
}

const provider: Provider = {
  id: "gemini",
  name: "Gemini CLI",
  fetch: fetchUsage,
  help: "Needs Google login: run /auth in Gemini CLI and pick Login with Google. API-key mode reports no quota. Google ended this path for personal accounts on 2026-06-18 - Workspace and Code Assist accounts still work.",
  needsConfig: [],
};

export default provider;
