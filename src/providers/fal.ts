// Official Platform API, checked 2026-10-14:
// https://fal.ai/docs/platform-apis/v1/account/billing (expand=credits)
// https://fal.ai/docs/platform-apis/v1/models/usage (paged, BILLING preset).
import type { Extra, Provider, ProviderConfig, Snapshot } from "../types.ts";
import { BillingConfigError, billingEnvironment, billingJson, ENV_FILE_FIELD } from "./_billing.ts";
import { extra, isObject, monthStart, num, prop, snap, str, usd, win } from "./_util.ts";

async function monthlyUsage(key: string): Promise<{ spend: number; units: Map<string, number> }> {
  const url = new URL("https://api.fal.ai/v1/models/usage");
  url.search = new URLSearchParams({
    start: monthStart().iso,
    end: new Date().toISOString(),
    timeframe: "month",
    bound_to_timeframe: "false",
    expand: "time_series",
    limit: "100",
  }).toString();
  const seen = new Set<string>();
  let spend = 0;
  const units = new Map<string, number>();
  for (let page = 0; page < 20; page++) {
    const result = await billingJson(url.href, { headers: { Authorization: `Key ${key}` } });
    if (!result.ok)
      throw new BillingConfigError(`Month usage unavailable (HTTP ${result.status}); a BILLING key is required.`);
    if (!isObject(result.json) || !Array.isArray(result.json.time_series))
      throw new BillingConfigError("fal.ai returned an invalid month usage report.");
    for (const bucket of result.json.time_series) {
      const rows = prop(bucket, "results");
      if (!Array.isArray(rows)) throw new BillingConfigError("fal.ai returned invalid usage rows.");
      for (const row of rows) {
        const cost = num(prop(row, "cost_total")) ?? num(prop(row, "cost"));
        if (cost === null || prop(row, "currency") !== "USD")
          throw new BillingConfigError("Month usage is not a complete USD report.");
        spend += cost;
        const unit = str(prop(row, "unit"));
        const quantity = num(prop(row, "quantity"));
        if (unit && quantity !== null) units.set(unit, (units.get(unit) ?? 0) + quantity);
      }
    }
    if (result.json.has_more === false) return { spend, units };
    const cursor = str(result.json.next_cursor);
    if (!cursor || seen.has(cursor))
      throw new BillingConfigError("fal.ai usage pagination is incomplete; month total unavailable.");
    seen.add(cursor);
    url.searchParams.set("cursor", cursor);
  }
  throw new BillingConfigError("fal.ai usage report exceeded the page limit; month total unavailable.");
}

async function fetchUsage(config: ProviderConfig): Promise<Snapshot> {
  try {
    const env = billingEnvironment(config);
    const key = config.apiKey || env.FAL_KEY;
    if (!key)
      return snap.notConfigured(
        "Add a fal.ai BILLING API key in Settings, or select a project env file containing FAL_KEY.",
      );
    const [billing, usage] = await Promise.all([
      billingJson("https://api.fal.ai/v1/account/billing?expand=credits", {
        headers: { Authorization: `Key ${key}` },
      }).catch(() => null),
      monthlyUsage(key)
        .then((value) => ({ value, message: "" }))
        .catch((error: unknown) => ({
          value: null,
          message: error instanceof BillingConfigError ? error.message : "Month usage is temporarily unavailable.",
        })),
    ]);
    const balance = billing?.ok ? num(prop(prop(billing.json, "credits"), "current_balance")) : null;
    const currency = billing?.ok ? str(prop(prop(billing.json, "credits"), "currency")) : null;
    if (balance === null && !usage.value) {
      if (billing?.status === 401 || billing?.status === 403)
        return snap.notConfigured(
          `fal.ai HTTP ${billing.status}: this key cannot read billing. Use a BILLING key for spend and credits, or READONLY for credits only.`,
        );
      return snap.error("fal.ai billing is unavailable; no zero balance has been assumed.");
    }
    const extras: Extra[] = [
      extra(
        "Credits remaining",
        balance === null
          ? "Unavailable to this key"
          : currency === "USD"
            ? usd(balance)
            : `${balance} ${currency ?? "(unknown currency)"}`,
      ),
    ];
    const windows = [];
    if (usage.value) {
      extras.push(extra("Month spend (UTC)", usd(usage.value.spend)));
      for (const [unit, quantity] of usage.value.units)
        extras.push(extra(`Month ${unit}`, quantity.toLocaleString("en-US")));
      const budget = Number(config.monthlyBudget);
      if (Number.isFinite(budget) && budget > 0)
        windows.push(
          win("Local monthly budget", (usage.value.spend / budget) * 100, null, {
            detail: `${usd(Math.max(0, budget - usage.value.spend))} local budget left; separate from credits`,
          }),
        );
    } else extras.push(extra("Month spend", "Unavailable"));
    return snap.ok({
      account: billing?.ok ? str(prop(billing.json, "username")) : null,
      windows,
      extras,
      message:
        usage.message ||
        (balance === null
          ? "Credits are not reported to this key."
          : "Usage is measured in each model's billing units, not a shared token allowance."),
    });
  } catch (error) {
    return snap.error(
      error instanceof BillingConfigError
        ? error.message
        : "Could not read fal.ai billing. Check connectivity and key permissions.",
    );
  }
}

const provider: Provider = {
  id: "fal",
  name: "fal.ai",
  fetch: fetchUsage,
  needsConfig: [
    {
      key: "apiKey",
      label: "Billing API key",
      help: "BILLING preset reads spend and credits. READONLY reads credits only. A generation-only key can return 403.",
      secret: true,
      docUrl: "https://fal.ai/dashboard/keys",
      docLabel: "Create key",
    },
    ENV_FILE_FIELD,
    { key: "monthlyBudget", label: "Local monthly USD budget — optional", placeholder: "50", secret: false },
  ],
};
export default provider;
