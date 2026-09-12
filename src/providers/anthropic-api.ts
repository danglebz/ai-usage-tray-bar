// Anthropic API (pay-as-you-go): month-to-date spend from the Usage & Cost Admin API.
//
// Tested 2026-09-12 on this machine's account, which has no organization:
//   - a workspace-scoped key    -> 401 "requires an Admin API key or an organization-scoped API key"
//   - an organization-scoped personal key -> 403 permission_error on EVERY Admin endpoint
//     (cost_report, usage_report, organizations/me, workspaces, users, api_keys)
// The uniform 403 is the documented "The Admin API is unavailable for individual accounts",
// not a per-endpoint role gap - so no key of any type works until an organization exists.
//   GET https://api.anthropic.com/v1/organizations/cost_report?starting_at=...&bucket_width=1d&limit=31
//   headers: x-api-key: <Admin API key sk-ant-admin01-...>, anthropic-version: 2023-06-01
// Amounts are decimal strings in cents. Needs an Admin key (or a non-workspace personal key);
// the Admin API is not available for individual accounts - Console → Settings → Organization.
// Optional config.monthlyBudget (USD) turns spend into a percent bar.

import type { Extra, Provider, ProviderConfig, Snapshot } from "../types.ts";
import { extra, fetchJson, isObject, monthStart, prop, snap, str, usd, win } from "./_util.ts";

async function fetchUsage(config: ProviderConfig): Promise<Snapshot> {
  const key = config.adminKey || process.env.ANTHROPIC_ADMIN_KEY;
  if (!key) return snap.notConfigured("Add an Anthropic Admin API key in Settings to see month-to-date API spend.");

  const start = monthStart().iso;
  const url = `https://api.anthropic.com/v1/organizations/cost_report?starting_at=${encodeURIComponent(start)}&bucket_width=1d&limit=31`;
  let res;
  try {
    res = await fetchJson(url, { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
  } catch (e) {
    return snap.error(`Network error: ${(e as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) {
    // A working sk-ant-api03 key still gets 401 here: cost reports need an Admin key. That is a
    // configuration fact, not a failure, so report it as such instead of a red error.
    return snap.notConfigured(
      `HTTP ${res.status}: the Admin API is closed to individual accounts. An organization-scoped key still gets 403 on every endpoint; an organization has to exist first (Console → Settings → Organization), then an Admin key from /settings/admin-keys. Meanwhile spend is visible at platform.claude.com/cost.`,
    );
  }
  if (!res.ok || !isObject(res.json)) return snap.error(`HTTP ${res.status} from cost_report`);

  let cents = 0;
  let today = 0;
  const todayIso = new Date().toISOString().slice(0, 10);
  const buckets: unknown[] = Array.isArray(res.json.data) ? res.json.data : [];
  for (const bucket of buckets) {
    const results: unknown[] = Array.isArray(prop(bucket, "results")) ? (prop(bucket, "results") as unknown[]) : [];
    for (const r of results) {
      const v = Number(prop(r, "amount") ?? 0) || 0;
      cents += v;
      if ((str(prop(bucket, "starting_at")) ?? "").slice(0, 10) === todayIso) today += v;
    }
  }
  const spend = cents / 100;
  const budget = Number(config.monthlyBudget) || 0;
  const windows =
    budget > 0
      ? [win("Monthly budget", (spend / budget) * 100, null, { detail: `${usd(spend)} / ${usd(budget)}` })]
      : [];
  const extras: Extra[] = [extra("Month to date", usd(spend)), extra("Today (UTC)", usd(today / 100))];
  if (res.json.has_more) extras.push(extra("Note", "more pages not fetched"));
  return snap.ok({ windows, extras });
}

const provider: Provider = {
  id: "anthropic-api",
  name: "Anthropic API",
  fetch: fetchUsage,
  needsConfig: [
    {
      key: "adminKey",
      label: "Admin API key",
      placeholder: "sk-ant-admin01-…",
      help: "Console → Settings → Admin keys, which exists only for organization accounts. An individual account cannot read cost reports with any key.",
      docUrl: "https://platform.claude.com/settings/admin-keys",
      docLabel: "Create key",
      secret: true,
    },
    {
      key: "monthlyBudget",
      label: "Monthly budget in USD — optional, draws the bar",
      placeholder: "50",
      secret: false,
    },
  ],
};

export default provider;
