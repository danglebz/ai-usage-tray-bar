// OpenRouter (prepaid credits + per-key limit). Documented API:
//   GET /api/v1/credits -> { data: { total_credits, total_usage } }
//   GET /api/v1/key     -> { data: { label, limit, usage, limit_remaining, is_free_tier,
//                                     usage_daily, usage_weekly, usage_monthly } }

import type { Extra, Provider, ProviderConfig, Snapshot, UsageWindow } from "../types.ts";
import { extra, fetchJson, isObject, num, prop, snap, str, usd, win } from "./_util.ts";

async function fetchUsage(config: ProviderConfig): Promise<Snapshot> {
  const key = config.apiKey || process.env.OPENROUTER_API_KEY;
  if (!key) return snap.notConfigured("Add your OpenRouter API key in Settings (or set OPENROUTER_API_KEY).");
  const headers = { Authorization: `Bearer ${key}` };

  let credits, keyInfo;
  try {
    [credits, keyInfo] = await Promise.all([
      fetchJson("https://openrouter.ai/api/v1/credits", { headers }),
      fetchJson("https://openrouter.ai/api/v1/key", { headers, timeoutMs: 5000 }).catch(() => null),
    ]);
  } catch (e) {
    return snap.error(`Network error: ${(e as Error).message}`);
  }
  if (credits.status === 401 || credits.status === 403) return snap.error("OpenRouter rejected the API key.");
  const c = prop(credits.json, "data");
  if (!credits.ok || !isObject(c)) return snap.error(`HTTP ${credits.status} from /credits`);

  const total = num(c.total_credits) ?? 0;
  const used = num(c.total_usage) ?? 0;
  const balance = total - used;
  const windows: UsageWindow[] = [];
  const extras: Extra[] = [extra("Balance", usd(balance)), extra("Lifetime", `${usd(used)} used of ${usd(total)}`)];

  const k = keyInfo?.ok ? prop(keyInfo.json, "data") : null;
  if (isObject(k)) {
    const limit = num(k.limit);
    const usage = num(k.usage) ?? 0;
    // A key whose limit equals the account credits would just repeat the "Credits used" bar.
    const sameAsCredits = total > 0 && limit != null && Math.abs(limit - total) < 0.01 && Math.abs(usage - used) < 0.01;
    if (limit != null && limit > 0 && !sameAsCredits) {
      const label = `Key limit (${str(k.label) ?? "key"})`;
      windows.push(win(label, (usage / limit) * 100, null, { detail: `${usd(usage)} / ${usd(limit)}` }));
    }
    for (const [f, label] of [
      ["usage_daily", "Today"],
      ["usage_weekly", "This week"],
      ["usage_monthly", "This month"],
    ] as const) {
      const v = num(k[f]);
      if (v != null) extras.push(extra(label, usd(v)));
    }
  }
  if (total > 0) windows.unshift(win("Credits used", (used / total) * 100, null, { detail: `${usd(balance)} left` }));

  return snap.ok({
    plan: isObject(k) && k.is_free_tier ? "free tier" : null,
    account: isObject(k) ? str(k.label) : null,
    windows,
    extras,
  });
}

const provider: Provider = {
  id: "openrouter",
  name: "OpenRouter",
  fetch: fetchUsage,
  needsConfig: [
    {
      key: "apiKey",
      label: "API key",
      placeholder: "sk-or-v1-…",
      help: "Any key works. A key with a credit limit also gets its own bar.",
      docUrl: "https://openrouter.ai/settings/keys",
      docLabel: "Create key",
      secret: true,
    },
  ],
};

export default provider;
