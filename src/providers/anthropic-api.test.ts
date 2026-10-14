import { afterEach, beforeEach, expect, it, vi } from "vitest";
import provider from "./anthropic-api.ts";
beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());
const usage = {
  data: [
    {
      results: [
        {
          uncached_input_tokens: 100,
          output_tokens: 20,
          cache_read_input_tokens: 30,
          cache_creation: { ephemeral_5m_input_tokens: 5, ephemeral_1h_input_tokens: 10 },
        },
      ],
    },
  ],
  has_more: false,
};
const cost = { data: [{ results: [{ amount: "125" }] }], has_more: false };
it("includes all cache tokens and converts cents while keeping Console credit unknown", async () => {
  vi.mocked(fetch).mockImplementation(async (url) => Response.json(String(url).includes("cost_report") ? cost : usage));
  const result = await provider.fetch({ adminKey: "test", monthlyBudget: 5, envFile: "C:/missing/.env" });
  expect(result.extras).toContainEqual({ label: "Month tokens (UTC)", value: "165" });
  expect(result.extras).toContainEqual({ label: "Month spend (UTC)", value: "$1.25" });
  expect(result.extras).toContainEqual({
    label: "Console credits remaining",
    value: "Not exposed by the Usage & Cost API",
  });
  expect(result.windows[0]?.percent).toBe(25);
});
it("retains spend when token-report access fails", async () => {
  vi.mocked(fetch).mockImplementation(async (url) =>
    String(url).includes("cost_report") ? Response.json(cost) : new Response("secret", { status: 403 }),
  );
  const result = await provider.fetch({ adminKey: "test" });
  expect(result.status).toBe("ok");
  expect(result.extras).toContainEqual({ label: "Month tokens", value: "Unavailable; report access failed" });
});
it("fetches all cost pages", async () => {
  vi.mocked(fetch).mockImplementation(async (url) =>
    Response.json(
      !String(url).includes("cost_report")
        ? usage
        : String(url).includes("page=")
          ? cost
          : { ...cost, has_more: true, next_page: "next" },
    ),
  );
  expect((await provider.fetch({ adminKey: "test" })).extras).toContainEqual({
    label: "Month spend (UTC)",
    value: "$2.50",
  });
});
it("explains Console permissions without returning rejected response bodies", async () => {
  vi.mocked(fetch).mockImplementation(async () => new Response("secret", { status: 403 }));
  const result = await provider.fetch({ adminKey: "test" });
  expect(result.status).toBe("not_configured");
  expect(result.message).toContain("organization");
  expect(JSON.stringify(result)).not.toContain("secret");
});

it("identifies a valid key when the account cannot access reports", async () => {
  vi.mocked(fetch).mockImplementation(async (url) =>
    String(url).endsWith("/organizations/me")
      ? Response.json({ id: "org-test" })
      : new Response("secret report error", { status: 403 }),
  );
  const result = await provider.fetch({ adminKey: "test" });
  expect(result.status).toBe("not_configured");
  expect(result.message).toContain("key is valid");
  expect(result.message).toContain("Individual organizations");
  expect(JSON.stringify(result)).not.toContain("secret");
});

it("retains the report permission error if account verification is unavailable", async () => {
  vi.mocked(fetch).mockImplementation(async (url) => {
    if (String(url).endsWith("/organizations/me")) throw new Error("secret network error");
    return new Response("secret report error", { status: 403 });
  });
  const result = await provider.fetch({ adminKey: "test" });
  expect(result.status).toBe("not_configured");
  expect(result.message).toContain("HTTP 403");
  expect(JSON.stringify(result)).not.toContain("secret");
});

it("reports a network outage as an error without revealing rejected headers", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("Invalid header: Bearer secret"));
  const result = await provider.fetch({ adminKey: "test" });
  expect(result.status).toBe("error");
  expect(JSON.stringify(result)).not.toContain("secret");
});

it("keeps tokens but withholds an incomplete cost total and its budget bar", async () => {
  vi.mocked(fetch).mockImplementation(async (url) =>
    Response.json(String(url).includes("cost_report") ? { ...cost, has_more: true } : usage),
  );
  const result = await provider.fetch({ adminKey: "test", monthlyBudget: 10 });
  expect(result.status).toBe("ok");
  expect(result.windows).toEqual([]);
  expect(result.extras).toContainEqual({ label: "Month spend", value: "Unavailable; report access failed" });
});
