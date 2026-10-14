// Project-scoped token counts from Content Automation's ledger; live remaining
// OpenRouter credits where the saved key can read them. No inference requests.
import type { Provider, ProviderConfig, Snapshot, UsageSection, UsageWindow } from "../types.ts";
import { extra, isObject, num, snap, usd, win } from "./_util.ts";
import { readRailwayUsage } from "./content-automation-railway.ts";
import {
  ProjectUsageError,
  readProjectUsage,
  type ProjectUsage,
  type UsageTotals,
} from "./content-automation-source.ts";

const LABELS: Record<string, string> = {
  openai: "OpenAI",
  openrouter: "OpenRouter",
  gemini: "Gemini",
  anthropic: "Anthropic",
  fal: "fal.ai",
  veo: "Veo video",
  google: "Google helpers",
};
const count = (n: number) => new Intl.NumberFormat("en-US").format(n);
const totalTokens = (u: UsageTotals) => u.inputTokens + u.outputTokens;
const TOTAL_FIELDS = [
  "calls",
  "inputTokens",
  "outputTokens",
  "images",
  "videoSeconds",
  "estimatedCostUsd",
  "unpricedCalls",
  "unmeteredCalls",
] as const;

function isTotals(value: unknown): value is UsageTotals {
  return isObject(value) && TOTAL_FIELDS.every((field) => num(value[field]) !== null && Number(value[field]) >= 0);
}
function isReport(value: unknown): value is ProjectUsage {
  return (
    isObject(value) &&
    typeof value.month === "string" &&
    /^\d{4}-\d{2}$/.test(value.month) &&
    typeof value.environment === "string" &&
    typeof value.resetsAt === "string" &&
    Number.isFinite(Date.parse(value.resetsAt)) &&
    (value.latestActivity === null ||
      (typeof value.latestActivity === "string" && Number.isFinite(Date.parse(value.latestActivity)))) &&
    Array.isArray(value.providers) &&
    value.providers.every(
      (p: unknown) => isObject(p) && typeof p.id === "string" && isTotals(p.month) && isTotals(p.lifetime),
    ) &&
    isObject(value.openrouter) &&
    typeof value.openrouter.note === "string" &&
    [value.openrouter.accountRemainingUsd, value.openrouter.keyRemainingUsd].every((v) => v === null || num(v) !== null)
  );
}

export function projectSnapshot(report: unknown, config: ProviderConfig = {}): Snapshot {
  if (!isReport(report)) return snap.error("Content Automation returned an invalid usage report.");
  const month = report.providers.map((p) => p.month);
  const sum = (field: keyof UsageTotals) => month.reduce((n, usage) => n + usage[field], 0);
  const spent = sum("estimatedCostUsd");
  const unpriced = sum("unpricedCalls");
  const extras = [
    extra("Tokens used this month", count(sum("inputTokens") + sum("outputTokens"))),
    extra("Input / output", `${count(sum("inputTokens"))} / ${count(sum("outputTokens"))}`),
    extra("Tokens used all time", count(report.providers.reduce((n, p) => n + totalTokens(p.lifetime), 0))),
    extra("Estimated month spend", `${usd(spent)}${unpriced ? ` + ${count(unpriced)} unpriced calls` : ""}`),
    extra("Tokens remaining", "Not reported by providers"),
  ];
  if (sum("unmeteredCalls"))
    extras.push(extra("Token coverage", `${count(sum("unmeteredCalls"))} calls have missing token counts`));
  extras.push(
    extra(
      "Last project activity",
      report.latestActivity
        ? new Date(report.latestActivity).toLocaleString("en-GB", { timeZone: "Asia/Bangkok", hour12: false }) +
            " (Bangkok)"
        : "No recorded calls",
    ),
  );
  const budget = Number(config.monthlyBudget);
  const windows: UsageWindow[] = [];
  if (Number.isFinite(budget) && budget > 0) {
    if (unpriced) extras.push(extra("Local budget remaining", "Unavailable while some calls are unpriced"));
    else
      windows.push(
        win("Local monthly budget (estimated)", (spent / budget) * 100, report.resetsAt, {
          detail: `${usd(Math.max(0, budget - spent))} left of ${usd(budget)}; not provider credit`,
        }),
      );
  }
  const sections: UsageSection[] = report.providers.map((p) => {
    const usage = p.month;
    const detail = [
      extra("Input / output tokens", `${count(usage.inputTokens)} / ${count(usage.outputTokens)}`),
      extra("All-time tokens", count(totalTokens(p.lifetime))),
      extra(
        "Calls / images / video seconds",
        `${count(usage.calls)} / ${count(usage.images)} / ${count(usage.videoSeconds)}`,
      ),
      extra(
        "Estimated month spend",
        `${usd(usage.estimatedCostUsd)}${usage.unpricedCalls ? ` + ${usage.unpricedCalls} unpriced` : ""}`,
      ),
    ];
    let remaining = "remaining unavailable";
    if (p.id === "openrouter") {
      const { accountRemainingUsd, keyRemainingUsd, note } = report.openrouter;
      detail.push(
        extra(
          "Account credits left",
          accountRemainingUsd === null ? "Unavailable to this key" : usd(accountRemainingUsd),
        ),
      );
      detail.push(extra("Key limit left", keyRemainingUsd === null ? "Not reported" : usd(keyRemainingUsd)));
      detail.push(extra("Credit source", note));
      if (accountRemainingUsd !== null) remaining = `${usd(accountRemainingUsd)} account credit left`;
      else if (keyRemainingUsd !== null) remaining = `${usd(keyRemainingUsd)} key limit left`;
    } else detail.push(extra("Remaining tokens / credits", "Unavailable with the project's inference key"));
    if (usage.unmeteredCalls)
      detail.push(extra("Token coverage", `${usage.unmeteredCalls} calls have missing token counts`));
    if (p.configured === false) detail.push(extra("Saved key", "Not configured; historical usage is retained"));
    return {
      title: LABELS[p.id] ?? p.id,
      summary: `${count(totalTokens(usage))} tokens · ${remaining}`,
      extras: detail,
    };
  });
  return snap.ok({
    plan: report.month,
    account: report.environment,
    message: "Project ledger · month in Bangkok time. Costs are estimates; provider-wide billing can differ.",
    windows,
    extras,
    sections,
  });
}

async function fetchUsage(config: ProviderConfig): Promise<Snapshot> {
  const folder = typeof config.projectPath === "string" ? config.projectPath.trim() : "";
  if (!folder) return snap.notConfigured("Choose your Content Automation project folder in Settings.");
  const environment = typeof config.railwayEnvironment === "string" ? config.railwayEnvironment.trim() : "";
  try {
    const report = environment
      ? await readRailwayUsage({
          projectPath: folder,
          environment,
          service: String(config.railwayService || "Frontend"),
          projectId: typeof config.railwayProjectId === "string" ? config.railwayProjectId.trim() : undefined,
        })
      : await readProjectUsage(
          folder,
          typeof config.envFile === "string" && config.envFile ? config.envFile : ".env.local",
        );
    return projectSnapshot(report, config);
  } catch (error) {
    // Both readers deliberately throw fixed, credential-free messages.
    return snap.error(
      error instanceof ProjectUsageError
        ? error.message
        : "Could not read project usage. Check the selected source and connectivity.",
    );
  }
}

const provider: Provider = {
  id: "content-automation",
  name: "Content Automation",
  fetch: fetchUsage,
  help: "Read project token counts and estimated spend. Fill in a Railway environment for the deployed app, or leave it blank to read local env files. No generation calls are made.",
  needsConfig: [
    { key: "projectPath", label: "Project folder", placeholder: "C:\\path\\to\\Content Automation", secret: false },
    {
      key: "railwayEnvironment",
      label: "Railway environment — optional",
      placeholder: "main",
      help: "Uses your Railway CLI login and registered SSH key; the database stays private.",
      secret: false,
    },
    { key: "railwayService", label: "Railway web service", placeholder: "Frontend", secret: false },
    {
      key: "railwayProjectId",
      label: "Railway project ID — optional",
      help: "Leave blank to use the project linked to this folder.",
      secret: false,
    },
    {
      key: "envFile",
      label: "Local env file — ignored in Railway mode",
      placeholder: ".env.local",
      help: "Select .env.development.local for the local development database. Legacy SUPABASE_DB_URL is supported.",
      secret: false,
    },
    {
      key: "monthlyBudget",
      label: "Local monthly budget in USD — optional",
      help: "A planning estimate, separate from the provider's actual credits.",
      placeholder: "50",
      secret: false,
    },
  ],
};
export default provider;
