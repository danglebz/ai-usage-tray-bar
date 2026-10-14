// Content Automation's ai_usage_logs ledger and global provider settings (schema verified
// 2026-10-14). pg comes from that project's install; credentials stay in its env files.
// No app imports: its normal readers can sweep jobs, whereas this connection is read-only.
import { createDecipheriv } from "node:crypto";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { parseEnv } from "node:util";
// Keep this module dependent only on Node built-ins: the same reader can run inside
// Railway without installing the tray app or transferring database credentials to it.
function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
function prop(value: unknown, key: string): unknown {
  return isObject(value) ? value[key] : undefined;
}
function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
async function fetchJson(url: string, options: { headers: Record<string, string>; timeoutMs: number }) {
  const response = await fetch(url, {
    headers: options.headers,
    signal: AbortSignal.timeout(options.timeoutMs),
    redirect: "error",
  });
  // Refused responses can echo credentials; don't read them.
  const json: unknown = response.ok ? await response.json() : null;
  if (!response.ok) await response.body?.cancel();
  return { ok: response.ok, status: response.status, json };
}

export interface UsageTotals {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  images: number;
  videoSeconds: number;
  estimatedCostUsd: number;
  unpricedCalls: number;
  unmeteredCalls: number;
}

export interface ProjectUsage {
  month: string;
  resetsAt: string;
  environment: string;
  database: "local" | "remote";
  databaseVariable: string;
  latestActivity: string | null;
  providers: {
    id: string;
    configured: boolean | null;
    month: UsageTotals;
    lifetime: UsageTotals;
  }[];
  openrouter: {
    accountRemainingUsd: number | null;
    keyRemainingUsd: number | null;
    note: string;
  };
}

interface QueryResult {
  rows: Record<string, unknown>[];
}
interface Client {
  query(sql: string, values?: unknown[]): Promise<QueryResult>;
  release(): void;
}
interface Pool {
  connect(): Promise<Client>;
  end(): Promise<void>;
  on(event: "error", listener: () => void): void;
}
interface PgModule {
  Pool: new (config: Record<string, unknown>) => Pool;
}

const FIELDS = [
  ["calls", "calls"],
  ["input_tokens", "inputTokens"],
  ["output_tokens", "outputTokens"],
  ["images", "images"],
  ["video_seconds", "videoSeconds"],
  ["cost_usd", "estimatedCostUsd"],
  ["unpriced_calls", "unpricedCalls"],
  ["unmetered_calls", "unmeteredCalls"],
] as const;

function totals(row: Record<string, unknown>, prefix: string): UsageTotals {
  const result = {} as UsageTotals;
  for (const [column, field] of FIELDS) result[field] = Number(row[prefix + column] ?? 0);
  return result;
}

// Explicit environment selection avoids inheriting a different project's DATABASE_URL from
// the tray process. The selected file wins over .env.local and .env, like the app launcher.
export function projectEnvironment(folder: string, filename: string): Record<string, string> {
  if (!/^\.env(?:\.[a-zA-Z0-9_-]+)*$/.test(filename))
    throw new Error("Choose an .env filename inside the project folder.");
  const env: Record<string, string> = {};
  for (const name of [".env", ".env.local"].filter((name) => name !== filename).concat(filename)) {
    const file = path.join(folder, name);
    if (!fs.existsSync(file) && name !== filename) continue;
    try {
      Object.assign(env, parseEnv(fs.readFileSync(file, "utf8")));
    } catch {
      throw new Error("Could not read the project's selected env file.");
    }
  }
  return env;
}

// The project's enc:v1 AES-GCM format, with an explicit key rather than mutating process.env
// while other providers refresh. Plaintext legacy rows are supported by the app as well.
export function revealProjectKey(stored: string, secret: string | undefined): string {
  if (!stored.startsWith("enc:v1:")) return stored;
  if (!secret || !/^[0-9a-f]{64}$/i.test(secret)) throw new Error("Project encryption key unavailable.");
  const parts = stored.slice(7).split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted project key.");
  const [iv, ciphertext, tag] = parts.map((part) => Buffer.from(part, "base64"));
  const decipher = createDecipheriv("aes-256-gcm", Buffer.from(secret, "hex"), iv!, { authTagLength: 16 });
  decipher.setAuthTag(tag!);
  return Buffer.concat([decipher.update(ciphertext!), decipher.final()]).toString("utf8");
}

// https://openrouter.ai/docs/api/api-reference/api-keys/get-current-api-key
// /credits may require a management key; /key still gives the calling key's own limit.
async function openrouterCredits(key: string): Promise<ProjectUsage["openrouter"]> {
  const result: ProjectUsage["openrouter"] = {
    accountRemainingUsd: null,
    keyRemainingUsd: null,
    note: "No OpenRouter key configured.",
  };
  if (!key) return result;
  const headers = { Authorization: `Bearer ${key}` };
  const [credits, info] = await Promise.all([
    fetchJson("https://openrouter.ai/api/v1/credits", { headers, timeoutMs: 5000 }).catch(() => null),
    fetchJson("https://openrouter.ai/api/v1/key", { headers, timeoutMs: 5000 }).catch(() => null),
  ]);
  const c = credits?.ok ? prop(credits.json, "data") : null;
  const k = info?.ok ? prop(info.json, "data") : null;
  const purchased = num(prop(c, "total_credits"));
  const used = num(prop(c, "total_usage"));
  if (purchased !== null && used !== null) result.accountRemainingUsd = purchased - used;
  result.keyRemainingUsd = num(prop(k, "limit_remaining"));
  result.note = isObject(k)
    ? "Live OpenRouter account/key credits in USD; not a token allowance."
    : "OpenRouter credit lookup unavailable; project usage is still shown.";
  if (result.accountRemainingUsd === null && isObject(k))
    result.note = "Account balance unavailable to this key. Key remaining is separate from account credits.";
  return result;
}

export async function readProjectUsage(
  folder: string,
  envFile = ".env.local",
  now = new Date(),
  runtimeEnv?: Record<string, string | undefined>,
): Promise<ProjectUsage> {
  if (!path.isAbsolute(folder)) throw new Error("Choose the absolute Content Automation project folder.");
  const env = runtimeEnv ?? projectEnvironment(folder, envFile);
  const databaseVariable = env.DATABASE_URL ? "DATABASE_URL" : "SUPABASE_DB_URL";
  const connectionString = env[databaseVariable];
  if (!connectionString) throw new Error("No DATABASE_URL or SUPABASE_DB_URL in the selected project environment.");
  let database: "local" | "remote";
  try {
    const url = new URL(connectionString);
    if (!/^postgres(?:ql)?:$/.test(url.protocol)) throw new Error();
    const host = url.searchParams.getAll("host").at(-1) || url.hostname;
    database = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(host) ? "local" : "remote";
  } catch {
    throw new Error("The project's database connection URL is invalid.");
  }
  let pg: PgModule;
  try {
    pg = createRequire(path.join(folder, "package.json"))("pg") as PgModule;
  } catch {
    throw new Error("Install Content Automation's dependencies so the tray can load its pg client.");
  }

  // Reporting months follow the project's Asia/Bangkok report, not the host's timezone.
  const month = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "2-digit",
  }).format(now);
  const start = new Date(`${month}-01T00:00:00+07:00`);
  // Construct next month by calendar components: UTC sees the previous month's last day.
  const [year, m] = month.split("-").map(Number);
  const resetsAt = new Date(Date.UTC(year!, m!, 1, -7)).toISOString();
  const pool = new pg.Pool({
    connectionString,
    max: 1,
    connectionTimeoutMillis: 6000,
    idleTimeoutMillis: 1000,
    application_name: "ai-usage-tray-readonly",
    options: "-c default_transaction_read_only=on -c statement_timeout=7000",
  });
  pool.on("error", () => {
    /* No raw pg errors: they can carry the connection string. */
  });
  let client: Client | undefined;
  let rows: Record<string, unknown>[] = [];
  let credentials: Record<string, unknown>[];
  let video: Record<string, unknown>;
  try {
    client = await pool.connect();
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    const aggregates = [
      "count(*) AS calls",
      "coalesce(sum(input_tokens), 0) AS input_tokens",
      "coalesce(sum(output_tokens), 0) AS output_tokens",
      "coalesce(sum(images), 0) AS images",
      "coalesce(sum(video_seconds), 0) AS video_seconds",
      "coalesce(sum(cost_usd), 0) AS cost_usd",
      "count(*) FILTER (WHERE cost_usd IS NULL) AS unpriced_calls",
      "count(*) FILTER (WHERE input_tokens IS NULL OR output_tokens IS NULL) AS unmetered_calls",
    ].join(", ");
    rows = (
      await client.query(
        `
      WITH lifetime AS (SELECT provider, ${aggregates}, max(created_at) AS latest FROM public.ai_usage_logs WHERE created_at < $2 GROUP BY provider),
      monthly AS (SELECT provider, ${aggregates} FROM public.ai_usage_logs WHERE created_at >= $1 AND created_at < $2 GROUP BY provider)
      SELECT l.provider, l.latest, ${FIELDS.flatMap(([column]) => [`l.${column} AS all_${column}`, `m.${column} AS month_${column}`]).join(", ")}
      FROM lifetime l LEFT JOIN monthly m USING (provider) ORDER BY l.provider`,
        [start.toISOString(), now.toISOString()],
      )
    ).rows;
    // Only OpenRouter's secret is read, solely for the free credit lookup. It never leaves this function.
    credentials = (
      await client.query(
        "SELECT provider, is_configured, CASE WHEN provider = 'openrouter' THEN api_key ELSE '' END AS api_key FROM public.ai_provider_credentials_global",
      )
    ).rows;
    video =
      (
        await client.query(
          "SELECT fal_key <> '' AS fal, gemini_api_key <> '' AS gemini, google_service_account_key <> '' AS vertex FROM public.ai_video_settings_global LIMIT 1",
        )
      ).rows[0] ?? {};
    await client.query("COMMIT");
  } catch (error) {
    if (client) await client.query("ROLLBACK").catch(() => undefined);
    const code =
      isObject(error) &&
      typeof error.code === "string" &&
      /^(?:[0-9A-Z]{5}|ECONNREFUSED|ENOTFOUND|ENETUNREACH|EHOSTUNREACH|ETIMEDOUT)$/.test(error.code)
        ? ` (${error.code})`
        : "";
    // eslint-disable-next-line preserve-caught-error -- pg's cause may contain credentials; expose only the code.
    throw new Error(
      `Could not read Content Automation's database${code}. Check the selected environment and database connectivity.`,
    );
  } finally {
    client?.release();
    await pool.end();
  }
  const configured = new Map<string, boolean | null>(
    ["openai", "openrouter", "gemini", "anthropic", "fal", "veo", "google"].map((id) => [id, false]),
  );
  for (const row of credentials) configured.set(String(row.provider), row.is_configured === true);
  configured.set("fal", video.fal === true || !!env.FAL_KEY);
  const google = video.gemini === true || !!env.GEMINI_API_KEY;
  configured.set("google", google);
  configured.set("veo", google || video.vertex === true || !!env.GOOGLE_SERVICE_ACCOUNT_KEY);
  for (const row of rows) if (!configured.has(String(row.provider))) configured.set(String(row.provider), null);
  let openrouter: ProjectUsage["openrouter"] = {
    accountRemainingUsd: null,
    keyRemainingUsd: null,
    note: "No OpenRouter key configured.",
  };
  try {
    const stored = credentials.find((row) => row.provider === "openrouter")?.api_key;
    openrouter = await openrouterCredits(
      typeof stored === "string" ? revealProjectKey(stored, env.AI_KEY_ENCRYPTION_SECRET) : "",
    );
  } catch {
    openrouter.note = "OpenRouter key cannot be decrypted; project usage is still shown.";
  }
  const latest = rows.map((r) => new Date(String(r.latest)).getTime()).filter(Number.isFinite);
  return {
    month,
    resetsAt,
    environment: envFile,
    database,
    databaseVariable,
    latestActivity: latest.length ? new Date(Math.max(...latest)).toISOString() : null,
    providers: [...configured].map(([id, enabled]) => {
      const row = rows.find((r) => r.provider === id) ?? {};
      return { id, configured: enabled, month: totals(row, "month_"), lifetime: totals(row, "all_") };
    }),
    openrouter,
  };
}
