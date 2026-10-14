import { generateKeyPairSync, verify } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
const pair = generateKeyPairSync("rsa", { modulusLength: 2048 });
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

it("signs only a Monitoring read token, uses Google's fixed endpoint, and caches it", async () => {
  const key = {
    client_email: "reader@example.iam.gserviceaccount.com",
    project_id: "test-project",
    private_key: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    token_uri: "https://evil.example/token",
  };
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", Buffer.from(JSON.stringify(key)).toString("base64"));
  vi.stubEnv("GOOGLE_CLOUD_PROJECT", "test-project");
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "this-unrelated-fallback-file-must-not-be-read.json");
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(async () => Response.json({ access_token: "test-token", expires_in: 3600 })),
  );
  const { googleAuth } = await import("./_google-auth.ts");
  const result = await googleAuth({});
  await googleAuth({});
  expect(result.token).toBe("test-token");
  expect(fetch).toHaveBeenCalledOnce();
  const [url, options] = vi.mocked(fetch).mock.calls[0]!;
  expect(url).toBe("https://oauth2.googleapis.com/token");
  const jwt = new URLSearchParams(String(options?.body)).get("assertion")!.split(".");
  const claims = JSON.parse(Buffer.from(jwt[1]!, "base64url").toString());
  expect(claims.scope).toBe("https://www.googleapis.com/auth/monitoring.read");
  expect(claims.aud).toBe("https://oauth2.googleapis.com/token");
  expect(claims.exp - claims.iat).toBe(3600);
  expect(
    verify("RSA-SHA256", Buffer.from(jwt.slice(0, 2).join(".")), pair.publicKey, Buffer.from(jwt[2]!, "base64url")),
  ).toBe(true);
  expect(String(options?.body)).not.toContain("PRIVATE KEY");
});
it("fails without touching any CLI OAuth files when no service account exists", async () => {
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", "");
  vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", "");
  vi.stubGlobal("fetch", vi.fn());
  const { googleAuth } = await import("./_google-auth.ts");
  await expect(googleAuth({})).rejects.toThrow("service-account");
  expect(fetch).not.toHaveBeenCalled();
});

it("uses a pasted key without reading stale env or credential file paths", async () => {
  vi.stubEnv("GOOGLE_CLOUD_PROJECT", "unrelated-project");
  vi.stubEnv("GOOGLE_SERVICE_ACCOUNT_KEY", "unrelated-credential");
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ access_token: "test-token" })));
  const { googleAuth } = await import("./_google-auth.ts");
  const result = await googleAuth({
    serviceAccountKey: JSON.stringify({
      client_email: "reader@example.iam.gserviceaccount.com",
      project_id: "pasted-key-project",
      private_key: pair.privateKey.export({ type: "pkcs8", format: "pem" }),
    }),
    envFile: "C:/missing/.env",
    serviceAccountFile: "C:/missing/key.json",
  });
  expect(result.project).toBe("pasted-key-project");
  expect(result.token).toBe("test-token");
});

it("rejects a model API key without sending it or echoing it in an error", async () => {
  vi.stubGlobal("fetch", vi.fn());
  const { googleAuth } = await import("./_google-auth.ts");
  const result = await googleAuth({ serviceAccountKey: "AIza-private-test-value" }).catch((error: Error) => error);
  expect(result).toBeInstanceOf(Error);
  expect(String(result)).toContain("JSON");
  expect(String(result)).not.toContain("AIza-private-test-value");
  expect(fetch).not.toHaveBeenCalled();
});
