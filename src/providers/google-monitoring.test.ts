import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchGoogle, quotaWindows } from "./_google-monitoring.ts";
import { googleAuth } from "./_google-auth.ts";
vi.mock("./_google-auth.ts", () => ({ googleAuth: vi.fn() }));
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn());
  vi.mocked(googleAuth).mockResolvedValue({ token: "test-google-token", project: "test-project", env: {} });
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetAllMocks();
});
const now = Date.now();
const row = (value: number, at = now - 180000, model = "gemini-2.5-flash", limit = "InputTokensPerMinute") => ({
  model,
  limit,
  location: "global",
  points: [{ value, at }],
});

it("matches model, location and period before calculating quota remaining", () => {
  const windows = quotaWindows([row(100)], [row(20), row(5), { ...row(70), location: "elsewhere" }], "gemini", now);
  expect(windows[0]?.percent).toBe(25);
  expect(windows[0]?.detail).toContain("75 left");
  expect(quotaWindows([row(100)], [row(20, now - 900000)], "gemini", now)[0]?.percent).toBeNull();
  expect(
    quotaWindows(
      [row(100, now - 180000, "gemini", "PerDay")],
      [row(20, now - 180000, "gemini", "PerDay")],
      "gemini",
      now,
    )[0]?.percent,
  ).toBeNull();
});
it("does not combine Gemini and Veo quotas or infer usage from missing samples", () => {
  expect(quotaWindows([row(100)], [], "gemini", now)[0]?.percent).toBeNull();
  expect(
    quotaWindows(
      [row(10, now - 180000, "veo-3.1", "RequestsPerMinute")],
      [row(2, now - 180000, "veo-3.1", "RequestsPerMinute")],
      "gemini",
      now,
    ),
  ).toEqual([]);
});
it("shows missing Monitoring permission without leaking upstream errors", async () => {
  vi.mocked(fetch).mockImplementation(async () => new Response("Bearer secret", { status: 403 }));
  const result = await fetchGoogle({}, "gemini");
  expect(result.status).toBe("not_configured");
  expect(result.message).toContain("Monitoring Viewer");
  expect(JSON.stringify(result)).not.toContain("secret");
});
it("reads Vertex Veo request counts without generating videos", async () => {
  vi.mocked(fetch).mockImplementation(async (url) => {
    const type = new URL(String(url)).searchParams.get("filter");
    return Response.json(
      type?.includes("model_invocation_count")
        ? {
            timeSeries: [
              {
                resource: { labels: { model_user_id: "veo-3.1" } },
                points: [{ value: { int64Value: "7" }, interval: { endTime: new Date().toISOString() } }],
              },
            ],
          }
        : {},
    );
  });
  const result = await fetchGoogle({ backend: "vertex" }, "veo");
  expect(result.extras).toContainEqual({ label: "Month requests (UTC)", value: "7" });
  expect(result.extras.find((x) => x.label === "Billing unit")?.value).toContain("requests/seconds");
  expect(
    vi.mocked(fetch).mock.calls.every(([url]) => String(url).startsWith("https://monitoring.googleapis.com/")),
  ).toBe(true);
});
it("does not label an empty Monitoring result zero tokens", async () => {
  vi.mocked(fetch).mockImplementation(async () => Response.json({}));
  expect((await fetchGoogle({}, "gemini")).extras).toContainEqual({
    label: "Month output tokens (UTC)",
    value: "No reported samples",
  });
});

it("collects all month token pages instead of silently undercounting", async () => {
  vi.mocked(fetch).mockImplementation(async (url) => {
    const request = new URL(String(url));
    if (!request.searchParams.get("filter")?.includes("generate_content_usage_output_token_count"))
      return Response.json({});
    const next = request.searchParams.has("pageToken");
    return Response.json({
      timeSeries: [
        {
          metric: { labels: { model: "gemini-2.5-flash" } },
          points: [{ value: { int64Value: next ? "3" : "5" }, interval: { endTime: new Date().toISOString() } }],
        },
      ],
      ...(next ? {} : { nextPageToken: "next-page" }),
    });
  });
  expect((await fetchGoogle({}, "gemini")).extras).toContainEqual({ label: "Month output tokens (UTC)", value: "8" });
});
