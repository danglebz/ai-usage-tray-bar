// OpenAI API (pay-as-you-go): month-to-date spend from the Costs endpoint.
//   GET https://api.openai.com/v1/organization/costs?start_time=<unix>&bucket_width=1d&limit=31
//   header: Authorization: Bearer <Admin key>
//   -> { data: [{ start_time, end_time, results: [{ amount: { value, currency }, line_item }] }], has_more }
// Needs an Admin API key (platform.openai.com → Organization → Admin keys).
// Optional config.monthlyBudget (USD) turns spend into a percent bar.

import type { Extra, Provider, ProviderConfig, Snapshot } from "../types.ts";
import { extra, fetchJson, isObject, monthStart, num, prop, snap, usd, win } from "./_util.ts";

async function fetchUsage(config: ProviderConfig): Promise<Snapshot> {
  const key = config.adminKey || process.env.OPENAI_ADMIN_KEY;
  if (!key) return snap.notConfigured("Add an OpenAI Admin API key in Settings to see month-to-date API spend.");

  const url = `https://api.openai.com/v1/organization/costs?start_time=${monthStart().unix}&bucket_width=1d&limit=31`;
  let res;
  try {
    res = await fetchJson(url, { headers: { Authorization: `Bearer ${key}` } });
  } catch (e) {
    return snap.error(`Network error: ${(e as Error).message}`);
  }
  if (res.status === 401 || res.status === 403) {
    // A working sk-proj key still gets 403 here: costs need an Admin key. Configuration, not failure.
    return snap.notConfigured(
      "Needs an Admin key (sk-admin-…) from platform.openai.com → Settings → Organization → Admin keys. A project key cannot read costs.",
    );
  }
  if (!res.ok || !isObject(res.json)) return snap.error(`HTTP ${res.status} from /organization/costs`);

  let spend = 0;
  let today = 0;
  const dayStart = Math.floor(Date.now() / 1000 / 86400) * 86400;
  const buckets: unknown[] = Array.isArray(res.json.data) ? res.json.data : [];
  for (const bucket of buckets) {
    const results: unknown[] = Array.isArray(prop(bucket, "results")) ? (prop(bucket, "results") as unknown[]) : [];
    for (const r of results) {
      const v = num(prop(prop(r, "amount"), "value")) ?? 0;
      spend += v;
      if (prop(bucket, "start_time") === dayStart) today += v;
    }
  }
  const budget = Number(config.monthlyBudget) || 0;
  const windows =
    budget > 0
      ? [win("Monthly budget", (spend / budget) * 100, null, { detail: `${usd(spend)} / ${usd(budget)}` })]
      : [];
  const extras: Extra[] = [extra("Month to date", usd(spend)), extra("Today (UTC)", usd(today))];
  if (res.json.has_more) extras.push(extra("Note", "more pages not fetched"));
  return snap.ok({ windows, extras });
}

const provider: Provider = {
  id: "openai-api",
  name: "OpenAI API",
  fetch: fetchUsage,
  needsConfig: [
    {
      key: "adminKey",
      label: "Admin API key",
      placeholder: "sk-admin-…",
      help: "Organization → Admin keys, not Project → API keys. A sk-proj-… key is rejected with 403.",
      docUrl: "https://platform.openai.com/settings/organization/admin-keys",
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
