// Claude Console's Usage & Cost Admin API, separate from Claude Code quotas.
// https://platform.claude.com/docs/en/manage-claude/usage-cost-api
import type { Extra, Provider, ProviderConfig, Snapshot } from "../types.ts";
import { BillingConfigError, billingEnvironment, billingJson, ENV_FILE_FIELD } from "./_billing.ts";
import { extra, isObject, monthStart, prop, snap, str, usd, win } from "./_util.ts";

async function report(key: string, endpoint: string, end: string): Promise<unknown[]> {
  const url = new URL(`https://api.anthropic.com/v1/organizations/${endpoint}`);
  url.search = new URLSearchParams({
    starting_at: monthStart().iso,
    ending_at: end,
    bucket_width: "1d",
    limit: "31",
  }).toString();
  const rows: unknown[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const result = await billingJson(url.href, { headers: { "x-api-key": key, "anthropic-version": "2023-06-01" } });
    if (result.status === 401)
      throw new BillingConfigError(
        "Claude Console HTTP 401: the configured key is invalid or expired. Replace it with an Admin key or an organization-scoped personal/service-account key.",
      );
    if (result.status === 403)
      throw new BillingConfigError(
        "Claude Console HTTP 403: usage reports need organization access. Use an Admin key or an organization-scoped personal/service-account key with report access; workspace-scoped keys cannot read these reports.",
      );
    if (!result.ok || !isObject(result.json) || !Array.isArray(result.json.data))
      throw new BillingConfigError(`Claude Console report unavailable (HTTP ${result.status}).`);
    for (const bucket of result.json.data) {
      const values = prop(bucket, "results");
      if (!Array.isArray(values)) throw new BillingConfigError("Claude Console returned invalid report rows.");
      rows.push(...values);
    }
    if (result.json.has_more === false) return rows;
    const next = str(result.json.next_page);
    if (!next || seen.has(next))
      throw new BillingConfigError("Claude Console pagination was incomplete; no partial total is shown.");
    seen.add(next);
    url.searchParams.set("page", next);
  }
  throw new BillingConfigError("Claude Console report exceeded the page limit; no partial total is shown.");
}
function number(value: unknown): number {
  if ((typeof value !== "number" && typeof value !== "string") || value === "" || !Number.isFinite(Number(value)))
    throw new BillingConfigError("Claude Console returned an invalid usage amount.");
  return Number(value);
}
async function fetchUsage(config: ProviderConfig): Promise<Snapshot> {
  try {
    const env = billingEnvironment(config);
    const key = config.adminKey || env.ANTHROPIC_ADMIN_KEY;
    if (!key)
      return snap.notConfigured(
        "Add a Claude Console Admin key or organization-scoped personal/service-account key, or select an env file containing ANTHROPIC_ADMIN_KEY. Workspace-scoped keys cannot read account reports.",
      );
    const end = new Date().toISOString();
    const [cost, usage] = await Promise.allSettled([
      report(key, "cost_report", end),
      report(key, "usage_report/messages", end),
    ]);
    if (cost.status === "rejected" && usage.status === "rejected") {
      const message =
        cost.reason instanceof BillingConfigError
          ? cost.reason.message
          : "Could not read Claude Console. Check credentials and connectivity.";
      return /HTTP (401|403)/.test(message) ? snap.notConfigured(message) : snap.error(message);
    }
    const extras: Extra[] = [];
    const windows = [];
    if (usage.status === "fulfilled") {
      let input = 0,
        output = 0,
        cached = 0;
      for (const row of usage.value) {
        const read = number(prop(row, "cache_read_input_tokens") ?? 0);
        const created = prop(row, "cache_creation");
        const write =
          number(prop(created, "ephemeral_1h_input_tokens") ?? 0) +
          number(prop(created, "ephemeral_5m_input_tokens") ?? 0);
        input += number(prop(row, "uncached_input_tokens")) + read + write;
        output += number(prop(row, "output_tokens"));
        cached += read + write;
      }
      extras.push(
        extra("Month tokens (UTC)", (input + output).toLocaleString("en-US")),
        extra("Input / output", `${input.toLocaleString("en-US")} / ${output.toLocaleString("en-US")}`),
        extra("Cached input (included)", cached.toLocaleString("en-US")),
      );
    } else extras.push(extra("Month tokens", "Unavailable; report access failed"));
    if (cost.status === "fulfilled") {
      const spend = cost.value.reduce<number>((sum, row) => sum + number(prop(row, "amount")) / 100, 0);
      extras.push(extra("Month spend (UTC)", usd(spend)));
      const budget = Number(config.monthlyBudget);
      if (Number.isFinite(budget) && budget > 0)
        windows.push(
          win("Local monthly budget", (spend / budget) * 100, null, {
            detail: `${usd(Math.max(0, budget - spend))} local budget left; separate from Console credits`,
          }),
        );
    } else extras.push(extra("Month spend", "Unavailable; report access failed"));
    extras.push(extra("Console credits remaining", "Not exposed by the Usage & Cost API"));
    return snap.ok({
      windows,
      extras,
      message:
        cost.status === "rejected" || usage.status === "rejected"
          ? "Only part of the Console report was accessible. Unavailable figures are not shown as zero."
          : "Usage comes from Claude Console. Purchased credit balance is separate from a local budget.",
    });
  } catch (error) {
    return snap.error(
      error instanceof BillingConfigError
        ? error.message
        : "Could not read Claude Console. Check credentials and connectivity.",
    );
  }
}
const provider: Provider = {
  id: "anthropic-api",
  name: "Claude Console",
  fetch: fetchUsage,
  needsConfig: [
    {
      key: "adminKey",
      label: "Console organization API key",
      placeholder: "sk-ant-admin01-…",
      help: "Use an Admin key or a personal/service-account key with Organization scope and Usage & Cost access. Workspace scope cannot read reports.",
      docUrl: "https://platform.claude.com/settings/keys",
      docLabel: "Create key",
      secret: true,
    },
    ENV_FILE_FIELD,
    { key: "monthlyBudget", label: "Local monthly USD budget — optional", placeholder: "50", secret: false },
  ],
};
export default provider;
