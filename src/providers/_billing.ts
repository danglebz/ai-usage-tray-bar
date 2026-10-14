// Read-only billing integrations share env-file loading and a fetch that never reads
// rejected response bodies (some vendors echo credentials in them).
import fs from "node:fs";
import path from "node:path";
import { parseEnv } from "node:util";
import type { ProviderConfig } from "../types.ts";
import { USER_AGENT } from "./_util.ts";

export class BillingConfigError extends Error {}
export function billingEnvironment(config: ProviderConfig): NodeJS.ProcessEnv {
  if (!config.envFile) return process.env;
  if (typeof config.envFile !== "string" || !path.isAbsolute(config.envFile))
    throw new BillingConfigError("Choose an absolute env-file path in Settings.");
  try {
    return { ...process.env, ...parseEnv(fs.readFileSync(config.envFile, "utf8")) };
  } catch {
    throw new BillingConfigError("Could not read the selected env file. Check its path in Settings.");
  }
}
export async function billingJson(
  url: string,
  options: { method?: "GET" | "POST"; headers: Record<string, string>; body?: string },
) {
  const response = await fetch(url, {
    ...options,
    headers: { "User-Agent": USER_AGENT, Accept: "application/json", ...options.headers },
    redirect: "error",
    signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) {
    await response.body?.cancel();
    return { ok: false, status: response.status, json: null };
  }
  const json: unknown = await response.json();
  return { ok: true, status: response.status, json };
}
