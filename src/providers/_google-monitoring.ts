// Official Monitoring v3 and Google metric definitions, verified 2026-10-14:
// https://docs.cloud.google.com/monitoring/api/metrics_gcp_d_h (Gemini API)
// https://docs.cloud.google.com/monitoring/api/metrics_gcp_a_b (Vertex / Veo)
import type { Extra, Provider, ProviderConfig, Snapshot, UsageWindow } from "../types.ts";
import { BillingConfigError, billingJson, ENV_FILE_FIELD } from "./_billing.ts";
import { googleAuth } from "./_google-auth.ts";
import { extra, isObject, monthStart, prop, snap, str, win } from "./_util.ts";

interface Point {
  at: number;
  value: number;
}
interface Series {
  model: string;
  limit: string;
  location: string;
  points: Point[];
}
interface Metric {
  series: Series[];
  status: number;
}
const count = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 2 });

async function metric(
  token: string,
  project: string,
  type: string,
  start: Date,
  end: Date,
  delta: boolean,
  period: number,
): Promise<Metric> {
  const url = new URL(`https://monitoring.googleapis.com/v3/projects/${encodeURIComponent(project)}/timeSeries`);
  url.search = new URLSearchParams({
    filter: `metric.type="${type}"`,
    "interval.startTime": start.toISOString(),
    "interval.endTime": end.toISOString(),
    view: "FULL",
    pageSize: "1000",
    ...(delta ? { "aggregation.alignmentPeriod": `${period}s`, "aggregation.perSeriesAligner": "ALIGN_SUM" } : {}),
  }).toString();
  const series: Series[] = [];
  const seen = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const result = await billingJson(url.href, { headers: { Authorization: `Bearer ${token}` } });
    if (!result.ok) return { series: [], status: result.status };
    if (!isObject(result.json) || (result.json.timeSeries !== undefined && !Array.isArray(result.json.timeSeries)))
      throw new BillingConfigError("Google returned an invalid Monitoring report.");
    for (const row of (result.json.timeSeries ?? []) as unknown[]) {
      const labels = prop(prop(row, "metric"), "labels");
      const resource = prop(prop(row, "resource"), "labels");
      const points = prop(row, "points");
      if (!Array.isArray(points)) throw new BillingConfigError("Google Monitoring returned invalid data points.");
      series.push({
        model:
          str(prop(labels, "model")) ||
          str(prop(labels, "base_model")) ||
          str(prop(resource, "model_user_id")) ||
          "unknown model",
        limit: str(prop(labels, "limit_name")) || "quota",
        location: str(prop(resource, "location")) || "global",
        points: points
          .map((point) => ({
            at: Date.parse(String(prop(prop(point, "interval"), "endTime"))),
            value: Number(prop(prop(point, "value"), "int64Value") ?? prop(prop(point, "value"), "doubleValue")),
          }))
          .filter((point) => Number.isFinite(point.at) && Number.isFinite(point.value)),
      });
    }
    const next = str(result.json.nextPageToken);
    if (!next) return { series, status: 200 };
    if (seen.has(next)) break;
    seen.add(next);
    url.searchParams.set("pageToken", next);
  }
  throw new BillingConfigError("Google Monitoring pagination was incomplete; no partial total is shown.");
}

export function quotaWindows(
  limits: Series[],
  usage: Series[],
  kind: "gemini" | "veo",
  now = Date.now(),
  quotaName = "",
): UsageWindow[] {
  const key = (s: Series) => `${s.model}|${s.limit}|${s.location}`;
  const windows: UsageWindow[] = [];
  for (const limit of limits.filter((s) => s.model.toLowerCase().includes(kind))) {
    const samples = usage
      .filter((s) => key(s) === key(limit))
      .flatMap((s) => s.points)
      .filter((p) => p.at <= now);
    const latest = Math.max(...samples.map((p) => p.at));
    const ceilings = [...limit.points].filter((p) => p.at <= now).sort((a, b) => b.at - a.at);
    const ceiling = ceilings.find((p) => !Number.isFinite(latest) || p.at <= latest) ?? ceilings[0];
    if (!ceiling || now - ceiling.at > 10 * 60000 || ceiling.value < 0) continue;
    const used =
      Number.isFinite(latest) && now - latest < 5 * 60000
        ? samples.filter((p) => p.at === latest).reduce((n, p) => n + p.value, 0)
        : null;
    // Do not compare a one-minute DELTA with a daily or unknown quota period.
    const comparable =
      used !== null && ceiling.at <= latest && latest - ceiling.at < 5 * 60000 && /per.?minute/i.test(limit.limit);
    const unit = /token/i.test(limit.limit + quotaName)
      ? "tokens"
      : /request|prediction/i.test(limit.limit + quotaName)
        ? "requests"
        : "quota";
    const period = /per.?minute/i.test(limit.limit) ? "/min" : /per.?day/i.test(limit.limit) ? "/day" : "";
    const tierName = limit.limit + " " + quotaName;
    const paid = tierName.match(/paid.?tier.?(\d+)?/i);
    const tier = /free.?tier/i.test(tierName) ? " · free" : paid ? ` · paid ${paid[1] || "1"}` : "";
    windows.push(
      win(
        `${limit.model} · ${unit}${period}${tier} · ${limit.location}`,
        comparable ? (ceiling.value > 0 ? (used / ceiling.value) * 100 : used > 0 ? 100 : 0) : null,
        null,
        {
          detail: comparable
            ? `${count(used)} used / ${count(ceiling.value)} · ${count(Math.max(0, ceiling.value - used))} left in the reported minute (${new Date(latest).toISOString()})`
            : `Limit ${count(ceiling.value)}; matching recent usage/period not reported`,
        },
      ),
    );
  }
  return windows;
}

export async function fetchGoogle(config: ProviderConfig, kind: "gemini" | "veo"): Promise<Snapshot> {
  try {
    const auth = await googleAuth(config);
    const backend = config.backend || (kind === "veo" ? auth.env.VEO_BACKEND : "gemini") || "gemini";
    if (backend !== "gemini" && backend !== "vertex")
      return snap.notConfigured("Google API backend must be gemini or vertex.");
    const now = new Date();
    const recent = new Date(now.getTime() - 15 * 60000);
    const start = new Date(monthStart().iso);
    const alignment = now.getTime() - start.getTime() >= 86400000 ? 86400 : 60;
    const base = backend === "vertex" ? "aiplatform.googleapis.com/" : "generativelanguage.googleapis.com/";
    const quotaNames =
      backend === "vertex"
        ? ["online_prediction_requests_per_base_model"]
        : kind === "veo"
          ? [
              "predict_long_running_requests_per_model",
              "predict_long_running_requests_per_model_free_tier",
              "predict_long_running_requests_per_model_paid_tier_2",
              "predict_long_running_requests_per_model_paid_tier_3",
            ]
          : [
              "generate_content_free_tier_input_token_count",
              "generate_content_paid_tier_input_token_count",
              "generate_content_paid_tier_2_input_token_count",
              "generate_content_paid_tier_3_input_token_count",
            ];
    const monthlyType =
      backend === "vertex"
        ? `publisher/online_serving/${kind === "veo" ? "model_invocation_count" : "token_count"}`
        : kind === "gemini"
          ? "generate_content_usage_output_token_count"
          : "quota/predict_long_running_requests_per_model/usage";
    const [monthly, ...quotas] = await Promise.all([
      metric(auth.token, auth.project, base + monthlyType, start, now, true, alignment),
      ...quotaNames.map(async (name) => {
        const [limit, usage] = await Promise.all([
          metric(auth.token, auth.project, `${base}quota/${name}/limit`, recent, now, false, 60),
          metric(auth.token, auth.project, `${base}quota/${name}/usage`, recent, now, true, 60),
        ]);
        return { name, limit, usage };
      }),
    ]);
    const all = [monthly, ...quotas.flatMap((q) => [q.limit, q.usage])];
    if (all.every((m) => m.status === 401 || m.status === 403))
      return snap.notConfigured(
        "Google denied Monitoring access. Grant Monitoring Viewer to the service account on the selected project, and enable the Monitoring API.",
      );
    if (all.every((m) => m.status !== 200))
      return snap.error("Google Monitoring is unavailable; no zero usage or unlimited quota has been assumed.");
    const matching = monthly.series.filter((s) => s.model.toLowerCase().includes(kind));
    const total = matching.reduce((n, s) => n + s.points.reduce((sum, p) => sum + p.value, 0), 0);
    const label =
      kind === "veo"
        ? backend === "gemini"
          ? "Month request quota (paid tier 1, UTC)"
          : "Month requests (UTC)"
        : backend === "vertex"
          ? "Month tokens (UTC)"
          : "Month output tokens (UTC)";
    const extras: Extra[] = [
      extra(label, matching.some((s) => s.points.length) ? count(total) : "No reported samples"),
      extra("Credit balance", "Not exposed by Cloud Monitoring"),
    ];
    if (kind === "veo")
      extras.push(extra("Billing unit", "Video generation uses requests/seconds; no fixed token balance"));
    if (kind === "gemini" && backend === "gemini")
      extras.push(extra("Input tokens", "Recent input-token usage and remaining are in the quota windows"));
    const windows = quotas.flatMap((q) => quotaWindows(q.limit.series, q.usage.series, kind, now.getTime(), q.name));
    if (!windows.length) extras.push(extra("Quota remaining", "No matching recent quota samples"));
    const failures = all.filter((m) => m.status !== 200);
    if (failures.length)
      extras.push(extra("Monitoring coverage", `${failures.length} metrics unavailable; no values inferred`));
    return snap.ok({
      account: auth.project,
      plan: backend === "vertex" ? "Vertex AI" : "Gemini API",
      windows,
      extras,
      message: "Reported usage and quota windows can lag. These figures are separate from Google billing credits.",
    });
  } catch (error) {
    return snap.error(
      error instanceof BillingConfigError
        ? error.message
        : "Could not read Google usage. Check credentials, Monitoring permissions and connectivity.",
    );
  }
}

export function googleProvider(kind: "gemini" | "veo"): Provider {
  return {
    id: kind === "veo" ? "google-veo" : "google-gemini",
    name: kind === "veo" ? "Google Veo" : "Google Gemini",
    fetch: (config) => fetchGoogle(config, kind),
    help: "Reads Google Cloud Monitoring using a service account with Monitoring Viewer. An inference API key alone cannot read historical usage or quotas.",
    needsConfig: [
      ENV_FILE_FIELD,
      {
        key: "serviceAccountFile",
        label: "Service-account JSON file — optional",
        help: "Alternatively read GOOGLE_SERVICE_ACCOUNT_KEY from the selected env file.",
        secret: false,
      },
      {
        key: "cloudProject",
        label: "Google Cloud project ID — optional",
        help: "Defaults to GOOGLE_CLOUD_PROJECT or the service account's project.",
        secret: false,
      },
      {
        key: "backend",
        label: "API backend — gemini or vertex",
        placeholder: kind === "veo" ? "vertex" : "gemini",
        secret: false,
      },
    ],
  };
}
