import { createCipheriv } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type * as Util from "./_util.ts";

const h = vi.hoisted(() => ({
  query: vi.fn(),
  connect: vi.fn(),
  release: vi.fn(),
  end: vi.fn(),
  options: {} as Record<string, unknown>,
}));
vi.mock("node:module", () => ({
  createRequire: () => () => ({
    Pool: class {
      constructor(options: Record<string, unknown>) {
        h.options = options;
      }
      connect = h.connect;
      end = h.end;
      on() {}
    },
  }),
}));
vi.mock("./_util.ts", async (original) => ({ ...(await original<typeof Util>()), fetchJson: vi.fn() }));

import { fetchJson } from "./_util.ts";
import { projectEnvironment, readProjectUsage, revealProjectKey } from "./content-automation-source.ts";

let folder: string;
beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "tray-project-"));
  fs.writeFileSync(
    path.join(folder, ".env.local"),
    "DATABASE_URL=postgres://u:secret@localhost/test\nFAL_KEY=test-fal",
  );
  vi.clearAllMocks();
  h.connect.mockResolvedValue({ query: h.query, release: h.release });
  h.end.mockResolvedValue(undefined);
  h.query.mockImplementation(async (sql: string) => {
    if (sql.includes("WITH lifetime"))
      return {
        rows: [
          {
            provider: "openai",
            all_calls: "4",
            all_input_tokens: "1000",
            all_output_tokens: "200",
            month_calls: "2",
            month_input_tokens: "400",
            month_output_tokens: "80",
            month_cost_usd: "0.0012",
            month_unmetered_calls: "1",
            latest: "2026-10-10T12:00:00Z",
          },
        ],
      };
    if (sql.includes("ai_provider_credentials_global"))
      return { rows: [{ provider: "openai", is_configured: true, api_key: "" }] };
    if (sql.includes("ai_video_settings_global")) return { rows: [] };
    return { rows: [] };
  });
});
afterEach(() => fs.rmSync(folder, { recursive: true, force: true }));

describe("project usage reader", () => {
  it("uses a read-only connection/transaction and parameterized Bangkok month boundaries", async () => {
    const result = await readProjectUsage(folder, ".env.local", new Date("2026-09-30T18:00:00Z"));
    expect(result.month).toBe("2026-10");
    expect(result.resetsAt).toBe("2026-10-31T17:00:00.000Z");
    expect(h.options.options).toContain("default_transaction_read_only=on");
    expect(h.query.mock.calls[0]?.[0]).toBe("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    expect(h.query.mock.calls.find(([sql]) => sql.includes("WITH lifetime"))?.[1]).toEqual([
      "2026-09-30T17:00:00.000Z",
      "2026-09-30T18:00:00.000Z",
    ]);
    expect(result.providers.find((p) => p.id === "openai")?.month).toMatchObject({
      calls: 2,
      inputTokens: 400,
      outputTokens: 80,
      estimatedCostUsd: 0.0012,
      unmeteredCalls: 1,
    });
    expect(result.providers.find((p) => p.id === "openai")?.lifetime.inputTokens).toBe(1000);
    expect(result.providers.find((p) => p.id === "fal")?.configured).toBe(true);
    expect(result.latestActivity).toBe("2026-10-10T12:00:00.000Z");
    expect(JSON.stringify(result)).not.toContain("secret");
    expect(fetchJson).not.toHaveBeenCalled();
    expect(h.release).toHaveBeenCalledOnce();
    expect(h.end).toHaveBeenCalledOnce();
  });

  it("rolls back and closes on a query error without revealing its message", async () => {
    h.query.mockRejectedValueOnce(new Error("password=do-not-show"));
    await expect(readProjectUsage(folder)).rejects.toThrow("Could not read Content Automation's database");
    expect(h.query).toHaveBeenCalledWith("ROLLBACK");
    expect(h.release).toHaveBeenCalledOnce();
    expect(h.end).toHaveBeenCalledOnce();
  });

  it("closes after a failed connection", async () => {
    h.connect.mockRejectedValueOnce(new Error("password=secret"));
    await expect(readProjectUsage(folder)).rejects.not.toThrow("password=");
    expect(h.end).toHaveBeenCalledOnce();
  });

  it("selects an environment explicitly, including the legacy database variable", async () => {
    fs.writeFileSync(path.join(folder, ".env.local"), "SUPABASE_DB_URL=postgres://u:secret@db.example.com/test");
    const result = await readProjectUsage(folder);
    expect(result.database).toBe("remote");
    expect(result.databaseVariable).toBe("SUPABASE_DB_URL");
    fs.writeFileSync(path.join(folder, ".env.development.local"), "DATABASE_URL=postgres://u:dev@localhost/test");
    expect(projectEnvironment(folder, ".env.development.local").DATABASE_URL).toContain(":dev@");
    fs.writeFileSync(path.join(folder, ".env"), "DATABASE_URL=postgres://u:base@localhost/test");
    expect(projectEnvironment(folder, ".env").DATABASE_URL).toContain(":base@");
  });

  it("refuses a path outside the selected project and missing database configuration", async () => {
    expect(() => projectEnvironment(folder, "../.env")).toThrow("inside the project");
    fs.writeFileSync(path.join(folder, ".env.local"), "");
    await expect(readProjectUsage(folder)).rejects.toThrow("No DATABASE_URL");
    expect(h.connect).not.toHaveBeenCalled();
  });

  it("keeps zero-usage and unknown historical providers visible", async () => {
    h.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("WITH lifetime") ? [{ provider: "historical", all_calls: "1" }] : [],
    }));
    const result = await readProjectUsage(folder);
    expect(result.providers.find((p) => p.id === "historical")).toMatchObject({
      configured: null,
      lifetime: { calls: 1 },
      month: { calls: 0 },
    });
    expect(result.providers.find((p) => p.id === "anthropic")).toMatchObject({
      configured: false,
      month: { inputTokens: 0 },
    });
    expect(result.latestActivity).toBeNull();
  });

  it("keeps key limits separate when account credits need a management key", async () => {
    h.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("ai_provider_credentials_global")
        ? [{ provider: "openrouter", is_configured: true, api_key: "test-or-key" }]
        : [],
    }));
    vi.mocked(fetchJson).mockImplementation(async (url) => ({
      ok: url.endsWith("/key"),
      status: url.endsWith("/key") ? 200 : 403,
      text: "",
      json: { data: { limit_remaining: 4.5 } },
    }));
    const result = await readProjectUsage(folder);
    expect(result.openrouter.accountRemainingUsd).toBeNull();
    expect(result.openrouter.keyRemainingUsd).toBe(4.5);
    expect(result.openrouter.note).toContain("separate");
    expect(JSON.stringify(result)).not.toContain("test-or-key");
  });

  it("preserves ledger totals when the free balance lookup fails", async () => {
    h.query.mockImplementation(async (sql: string) => ({
      rows: sql.includes("ai_provider_credentials_global") ? [{ provider: "openrouter", api_key: "key" }] : [],
    }));
    vi.mocked(fetchJson).mockRejectedValue(new Error("Bearer key"));
    const result = await readProjectUsage(folder);
    expect(result.openrouter.note).toContain("unavailable");
    expect(result.openrouter.accountRemainingUsd).toBeNull();
  });
});

describe("project key format", () => {
  it("decrypts the project's AES-GCM format without changing the process environment", () => {
    const key = "ab".repeat(32);
    const iv = Buffer.alloc(12, 1);
    const cipher = createCipheriv("aes-256-gcm", Buffer.from(key, "hex"), iv);
    const ciphertext = Buffer.concat([cipher.update("example-key"), cipher.final()]);
    const stored = `enc:v1:${iv.toString("base64")}:${ciphertext.toString("base64")}:${cipher.getAuthTag().toString("base64")}`;
    expect(revealProjectKey(stored, key)).toBe("example-key");
    expect(() => revealProjectKey(stored, "cd".repeat(32))).toThrow();
    expect(revealProjectKey("legacy-key", undefined)).toBe("legacy-key");
  });
});
