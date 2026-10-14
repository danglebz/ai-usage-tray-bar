// Official service-account JWT exchange; never refreshes CLI credentials.
// https://developers.google.com/identity/protocols/oauth2/service-account
import { createHash, createSign } from "node:crypto";
import fs from "node:fs";
import type { ProviderConfig } from "../types.ts";
import { BillingConfigError, billingEnvironment, billingJson } from "./_billing.ts";
import { isObject, num, str } from "./_util.ts";

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const cache = new Map<string, { token: string; expires: number }>();
export async function googleAuth(config: ProviderConfig) {
  const env = billingEnvironment(config);
  let raw = env.GOOGLE_SERVICE_ACCOUNT_KEY || "";
  const file =
    typeof config.serviceAccountFile === "string" && config.serviceAccountFile
      ? config.serviceAccountFile
      : env.GOOGLE_APPLICATION_CREDENTIALS;
  if (file) {
    try {
      raw = fs.readFileSync(file, "utf8");
    } catch {
      throw new BillingConfigError("Could not read the Google service-account JSON file.");
    }
  }
  if (!raw)
    throw new BillingConfigError(
      "Choose a service-account JSON file or a project env file containing GOOGLE_SERVICE_ACCOUNT_KEY. Monitoring Viewer is required.",
    );
  let key: unknown;
  try {
    const text = raw.trim().replace(/^\uFEFF/, "");
    key = JSON.parse(
      text.startsWith("{")
        ? text
        : Buffer.from(text, "base64")
            .toString("utf8")
            .replace(/^\uFEFF/, ""),
    );
  } catch {
    throw new BillingConfigError("Google service-account credentials are not valid JSON or base64 JSON.");
  }
  if (!isObject(key) || !str(key.client_email) || !str(key.private_key))
    throw new BillingConfigError("Google credentials need client_email and private_key.");
  const project =
    typeof config.cloudProject === "string" && config.cloudProject.trim()
      ? config.cloudProject.trim()
      : env.GOOGLE_CLOUD_PROJECT || str(key.project_id);
  if (!project || !/^[a-zA-Z0-9][a-zA-Z0-9-]{3,62}$/.test(project))
    throw new BillingConfigError("Choose the Google Cloud project ID in Settings.");
  const fingerprint = createHash("sha256").update(raw).digest("hex");
  let cached = cache.get(fingerprint);
  if (!cached || cached.expires < Date.now() + 60000) {
    const now = Math.floor(Date.now() / 1000);
    const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const assertion = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ iss: key.client_email, scope: "https://www.googleapis.com/auth/monitoring.read", aud: TOKEN_URL, iat: now, exp: now + 3600 })}`;
    let signature: string;
    try {
      signature = createSign("RSA-SHA256").update(assertion).sign(String(key.private_key)).toString("base64url");
    } catch {
      throw new BillingConfigError("The Google service-account private key could not sign a read-only access token.");
    }
    const result = await billingJson(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: `${assertion}.${signature}`,
      }).toString(),
    });
    if (!result.ok || !isObject(result.json) || !str(result.json.access_token))
      throw new BillingConfigError(`Google could not authorize the service account (HTTP ${result.status}).`);
    cached = {
      token: String(result.json.access_token),
      expires: Date.now() + Math.min(num(result.json.expires_in) ?? 3600, 3600) * 1000,
    };
    if (cache.size > 4) cache.clear();
    cache.set(fingerprint, cached);
  }
  return { token: cached.token, project, env };
}
