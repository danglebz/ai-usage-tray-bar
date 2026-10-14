import { beforeEach, expect, it, vi } from "vitest";
import provider, { projectSnapshot } from "./content-automation.ts";
import {
  ProjectUsageError,
  readProjectUsage,
  type ProjectUsage,
  type UsageTotals,
} from "./content-automation-source.ts";
import { readRailwayUsage } from "./content-automation-railway.ts";

vi.mock("./content-automation-source.ts", async (original) => {
  const actual = await original<{ ProjectUsageError: typeof Error }>();
  return { ...actual, readProjectUsage: vi.fn() };
});
vi.mock("./content-automation-railway.ts", () => ({ readRailwayUsage: vi.fn() }));
const totals = (values: Partial<UsageTotals> = {}): UsageTotals => ({
  calls: 0,
  inputTokens: 0,
  outputTokens: 0,
  images: 0,
  videoSeconds: 0,
  estimatedCostUsd: 0,
  unpricedCalls: 0,
  unmeteredCalls: 0,
  ...values,
});
function report(): ProjectUsage {
  return {
    month: "2026-10",
    resetsAt: "2026-10-31T17:00:00Z",
    environment: "Railway / main",
    database: "remote",
    databaseVariable: "DATABASE_URL",
    latestActivity: null,
    providers: [
      {
        id: "openai",
        configured: true,
        month: totals({ calls: 1, inputTokens: 1000, outputTokens: 200, estimatedCostUsd: 4 }),
        lifetime: totals({ inputTokens: 5000, outputTokens: 1000 }),
      },
      {
        id: "openrouter",
        configured: true,
        month: totals({ calls: 2, inputTokens: 200, outputTokens: 100, estimatedCostUsd: 1 }),
        lifetime: totals({ inputTokens: 200, outputTokens: 100 }),
      },
    ],
    openrouter: { accountRemainingUsd: 8.5, keyRemainingUsd: 3, note: "Live account/key credit, USD" },
  };
}
beforeEach(() => {
  vi.resetAllMocks();
});

it("shows project-scoped month and lifetime totals with credit and token units kept separate", () => {
  const result = projectSnapshot(report(), { monthlyBudget: "10" });
  expect(result.status).toBe("ok");
  expect(result.extras).toContainEqual({ label: "Tokens used this month", value: "1,500" });
  expect(result.extras).toContainEqual({ label: "Tokens used all time", value: "6,300" });
  expect(result.extras).toContainEqual({ label: "Tokens remaining", value: "Not reported by providers" });
  expect(result.windows[0]).toMatchObject({ percent: 50, resetsAt: "2026-10-31T17:00:00.000Z" });
  expect(result.windows[0]?.detail).toContain("not provider credit");
  expect(result.sections?.find((s) => s.title === "OpenRouter")?.extras).toContainEqual({
    label: "Account credits left",
    value: "$8.50",
  });
  expect(result.sections?.find((s) => s.title === "OpenRouter")?.extras).toContainEqual({
    label: "Key limit left",
    value: "$3.00",
  });
});

it("does not invent remaining budget when costs or token counts are missing", () => {
  const data = report();
  data.providers[0]!.month.unpricedCalls = 1;
  data.providers[0]!.month.unmeteredCalls = 1;
  data.openrouter.accountRemainingUsd = null;
  data.openrouter.keyRemainingUsd = null;
  const result = projectSnapshot(data, { monthlyBudget: "10" });
  expect(result.windows).toEqual([]);
  expect(result.extras).toContainEqual({
    label: "Local budget remaining",
    value: "Unavailable while some calls are unpriced",
  });
  expect(result.extras.find((x) => x.label === "Token coverage")?.value).toContain("missing token counts");
  expect(result.sections?.find((s) => s.title === "OpenRouter")?.summary).toContain("unavailable");
});

it.each([null, {}, { month: "2026-10", providers: [] }])(
  "refuses malformed reports instead of showing zero usage",
  (data) => {
    expect(projectSnapshot(data).status).toBe("error");
  },
);

it("uses the selected local environment and never contacts Railway", async () => {
  vi.mocked(readProjectUsage).mockResolvedValue(report());
  expect((await provider.fetch({ projectPath: "C:/Project", envFile: ".env.development.local" })).status).toBe("ok");
  expect(readProjectUsage).toHaveBeenCalledWith("C:/Project", ".env.development.local");
  expect(readRailwayUsage).not.toHaveBeenCalled();
});

it("selects the deployed project explicitly", async () => {
  vi.mocked(readRailwayUsage).mockResolvedValue(report());
  await provider.fetch({ projectPath: "C:/Project", railwayEnvironment: "main", railwayProjectId: "project-id" });
  expect(readRailwayUsage).toHaveBeenCalledWith({
    projectPath: "C:/Project",
    environment: "main",
    service: "Frontend",
    projectId: "project-id",
  });
  expect(readProjectUsage).not.toHaveBeenCalled();
});

it("shows fixed setup errors but hides unexpected errors that may contain credentials", async () => {
  vi.mocked(readProjectUsage).mockRejectedValueOnce(
    new ProjectUsageError("Choose an .env filename inside the project folder."),
  );
  expect((await provider.fetch({ projectPath: "C:/Project" })).message).toContain(".env filename");
  vi.mocked(readProjectUsage).mockRejectedValueOnce(new Error("password=do-not-show"));
  expect((await provider.fetch({ projectPath: "C:/Project" })).message).not.toContain("password=");
});

it("stays unconfigured until a project is chosen", async () => {
  expect((await provider.fetch({})).status).toBe("not_configured");
  expect(readProjectUsage).not.toHaveBeenCalled();
});
