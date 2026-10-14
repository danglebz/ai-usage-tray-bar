import { afterEach, beforeEach, expect, it, vi } from "vitest";
import provider from "./fal.ts";
const key = { apiKey: "test-key" };
beforeEach(() => vi.stubGlobal("fetch", vi.fn()));
afterEach(() => vi.unstubAllGlobals());
const bill = { username: "test", credits: { current_balance: 12.5, currency: "USD" } };
const usage = {
  time_series: [{ results: [{ cost_total: 2, currency: "USD", quantity: 8, unit: "second" }] }],
  has_more: false,
};

it("shows real credits and billing units, without labelling a budget as provider balance", async () => {
  vi.mocked(fetch).mockImplementation(async (url) =>
    Response.json(String(url).includes("account/billing") ? bill : usage),
  );
  const result = await provider.fetch({ ...key, monthlyBudget: 10, envFile: "C:/missing/.env" });
  expect(result.extras).toContainEqual({ label: "Credits remaining", value: "$12.50" });
  expect(result.extras).toContainEqual({ label: "Month second", value: "8" });
  expect(result.windows[0]?.percent).toBe(20);
  expect(result.windows[0]?.detail).toContain("separate from credits");
  expect(fetch).toHaveBeenCalledWith(
    expect.stringContaining("expand=credits"),
    expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Key test-key" }), redirect: "error" }),
  );
});
it("fetches all usage pages before showing a month total", async () => {
  vi.mocked(fetch).mockImplementation(async (url) =>
    Response.json(
      String(url).includes("account/billing")
        ? bill
        : String(url).includes("cursor=")
          ? usage
          : { ...usage, has_more: true, next_cursor: "second" },
    ),
  );
  expect((await provider.fetch(key)).extras).toContainEqual({ label: "Month spend (UTC)", value: "$4.00" });
});
it("keeps a valid credit balance when a READONLY key cannot read spend", async () => {
  vi.mocked(fetch).mockImplementation(async (url) =>
    String(url).includes("account/billing") ? Response.json(bill) : new Response("secret", { status: 403 }),
  );
  const result = await provider.fetch(key);
  expect(result.status).toBe("ok");
  expect(result.message).toContain("BILLING");
  expect(result.extras).toContainEqual({ label: "Month spend", value: "Unavailable" });
});
it("explains inference-only permissions without echoing the API error body", async () => {
  vi.mocked(fetch).mockResolvedValue(new Response("secret", { status: 403 }));
  const result = await provider.fetch(key);
  expect(result.status).toBe("not_configured");
  expect(result.message).toContain("BILLING");
  expect(JSON.stringify(result)).not.toContain("secret");
});
it("does not show partial or malformed reports as zero spend", async () => {
  vi.mocked(fetch).mockImplementation(async (url) =>
    Response.json(String(url).includes("account/billing") ? bill : {}),
  );
  const result = await provider.fetch(key);
  expect(result.extras).toContainEqual({ label: "Month spend", value: "Unavailable" });
  expect(result.message).toContain("invalid");
});
it("hides credential-bearing network exceptions", async () => {
  vi.mocked(fetch).mockRejectedValue(new Error("Bearer test-secret"));
  expect(JSON.stringify(await provider.fetch(key))).not.toContain("test-secret");
});
