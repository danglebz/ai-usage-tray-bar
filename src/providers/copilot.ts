// GitHub Copilot (premium request quota).
//
// Endpoint and headers per CodexBar docs/copilot.md: GET api.github.com/copilot_internal/user
// with a GitHub OAuth token. Field names are the snake_case JSON GitHub returns
// (quota_snapshots.premium_interactions.percent_remaining, quota_reset_date, copilot_plan).
//
// Token sources, in order:
//   1. config.copilot.githubToken  (paste from `gh auth token` or a token with read:user)
//   2. %LOCALAPPDATA%/github-copilot/apps.json | hosts.json  (VS Code / JetBrains / CLI logins)
//   3. `gh auth token` if the GitHub CLI is installed and logged in
// Verified 2026-09-12 against a live 200 response via `gh auth token` (Copilot Free:
// premium_interactions comes back with has_quota=false / entitlement=0 and is hidden).

import { execFileSync } from "node:child_process";
import path from "node:path";
import type { Extra, Provider, ProviderConfig, Snapshot, UsageWindow } from "../types.ts";
import { extra, fetchJson, home, isObject, num, prop, readJsonObject, snap, str, win } from "./_util.ts";

const URL = "https://api.github.com/copilot_internal/user";

interface TokenSource {
  token: string;
  user: string | null;
  /** Where the token came from, for the "Token from" line. */
  from: string;
}

function tokenFromCopilotFiles(): TokenSource | null {
  const dirs = [
    process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, "github-copilot") : null,
    home(".config", "github-copilot"),
  ].filter((d): d is string => d != null);
  for (const dir of dirs) {
    for (const file of ["apps.json", "hosts.json"]) {
      const j = readJsonObject(path.join(dir, file));
      if (!j) continue;
      for (const [host, v] of Object.entries(j)) {
        const token = str(prop(v, "oauth_token"));
        if (host.startsWith("github.com") && token) return { token, user: str(prop(v, "user")), from: file };
      }
    }
  }
  return null;
}

function tokenFromGh(): TokenSource | null {
  try {
    const t = execFileSync("gh", ["auth", "token"], { encoding: "utf8", timeout: 5000, windowsHide: true }).trim();
    return t ? { token: t, user: null, from: "gh auth token" } : null;
  } catch {
    return null;
  }
}

function resolveToken(config: ProviderConfig): TokenSource | null {
  if (config.githubToken) return { token: config.githubToken, user: null, from: "config" };
  return tokenFromCopilotFiles() ?? tokenFromGh();
}

function snapshotWindow(label: string, q: unknown, resetDate: unknown): UsageWindow | null {
  if (!isObject(q)) return null;
  if (q.has_quota === false || (q.entitlement === 0 && !q.unlimited)) return null; // not included in this plan
  if (q.unlimited) return win(label, 0, resetDate, { note: "unlimited" });
  const remaining = num(q.remaining);
  const entitlement = num(q.entitlement);
  const percentRemaining = num(q.percent_remaining);
  let used: number | null = null;
  if (percentRemaining != null) used = 100 - percentRemaining;
  else if (entitlement != null && entitlement > 0 && remaining != null) used = 100 - (remaining / entitlement) * 100;
  const w = win(label, used, resetDate);
  if (remaining != null && entitlement != null) w.detail = `${remaining} / ${entitlement} left`;
  return w;
}

async function fetchUsage(config: ProviderConfig): Promise<Snapshot> {
  const src = resolveToken(config);
  if (!src) {
    return snap.notLoggedIn(
      "No GitHub token found. Paste one in Settings, or sign in to Copilot in VS Code / `gh auth login`.",
    );
  }

  let res;
  try {
    res = await fetchJson(URL, {
      headers: {
        Authorization: `token ${src.token}`,
        "Editor-Version": "vscode/1.96.2",
        "Editor-Plugin-Version": "copilot-chat/0.26.7",
        "User-Agent": "GitHubCopilotChat/0.26.7",
        "X-Github-Api-Version": "2025-04-01",
      },
    });
  } catch (e) {
    return snap.error(`Network error: ${(e as Error).message}`);
  }
  if (res.status === 401) return snap.expired(`GitHub rejected the token from ${src.from} (401).`);
  if (res.status === 403 || res.status === 404) {
    return snap.error(`HTTP ${res.status}: this token has no Copilot access (token from ${src.from}).`);
  }
  if (!res.ok || !isObject(res.json)) return snap.error(`HTTP ${res.status} from copilot_internal/user`);

  const j = res.json;
  const qs = j.quota_snapshots ?? j.quotaSnapshots;
  const reset = j.quota_reset_date ?? j.quotaResetDate ?? null;
  const windows = [
    snapshotWindow("Premium requests", prop(qs, "premium_interactions") ?? prop(qs, "premiumInteractions"), reset),
    snapshotWindow("Chat", prop(qs, "chat"), reset),
    snapshotWindow("Completions", prop(qs, "completions"), reset),
  ].filter((w): w is UsageWindow => w != null);
  const extras: Extra[] = [extra("Token from", src.from)];

  const sku = str(j.access_type_sku) ?? "";
  const plan = /free/i.test(sku) ? "Free" : (str(j.copilot_plan) ?? str(j.copilotPlan) ?? sku ?? null);
  if (!windows.length) extras.push(extra("Note", "no metered quota on this plan"));

  return snap.ok({ plan: plan || null, account: src.user, windows, extras });
}

const provider: Provider = {
  id: "copilot",
  name: "GitHub Copilot",
  fetch: fetchUsage,
  needsConfig: [
    {
      key: "githubToken",
      label: "GitHub token",
      placeholder: "ghp_… or github_pat_…",
      help: "Usually leave this empty - the token is read from your VS Code Copilot login or `gh auth login`. Paste one only if neither is present; it needs the read:user scope.",
      docUrl: "https://github.com/settings/tokens",
      docLabel: "GitHub tokens",
      secret: true,
    },
  ],
};

export default provider;
