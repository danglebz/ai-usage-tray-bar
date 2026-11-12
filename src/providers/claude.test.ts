import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import provider, { planLabel, windowsFrom } from "./claude.ts";
import { summarize } from "./claude-local.ts";
import { readJson, win } from "./_util.ts";

// The credentials file and the local-log summary are mocked so these tests never read the real
// ~/.claude directory. Everything else in _util.ts (win, fetchJson, snap, ...) stays real.
vi.mock("./_util.ts", async () => ({
  ...(await vi.importActual<Record<string, unknown>>("./_util.ts")),
  home: (...parts: string[]) => ["C:/fake-home", ...parts].join("/"),
  readJson: vi.fn(),
}));
vi.mock("./claude-local.ts", () => ({ summarize: vi.fn() }));

const RESET_A = "2030-01-01T05:00:00.000Z";
const RESET_B = "2030-01-07T00:00:00.000Z";

// Shape of the live Max 20x response: limits[] AND the legacy top-level objects.
const liveMax = {
  five_hour: { utilization: 13, resets_at: RESET_A },
  seven_day: { utilization: 67, resets_at: RESET_B },
  seven_day_opus: null,
  seven_day_sonnet: null,
  limits: [
    {
      kind: "session",
      group: "session",
      percent: 13,
      resets_at: RESET_A,
      scope: null,
      severity: "normal",
      is_active: false,
    },
    {
      kind: "weekly_all",
      group: "weekly",
      percent: 67,
      resets_at: RESET_B,
      scope: null,
      severity: "normal",
      is_active: true,
    },
    {
      kind: "weekly_scoped",
      group: "weekly",
      percent: 0,
      resets_at: null,
      scope: { model: { display_name: "Fable" } },
      severity: "normal",
      is_active: false,
    },
  ],
};
const legacyOnly = {
  five_hour: { utilization: 21, resets_at: RESET_A },
  seven_day: { utilization: 44, resets_at: RESET_B },
};
const row = (over: Record<string, unknown>) => ({
  kind: "weekly_all",
  group: "weekly",
  percent: 20,
  resets_at: RESET_B,
  scope: null,
  severity: "normal",
  is_active: true,
  ...over,
});

describe("windowsFrom", () => {
  it("maps the live Max shape to exactly three windows and does not repeat the legacy keys", () => {
    const windows = windowsFrom(liveMax);
    expect(windows.map((w) => w.label)).toEqual(["5-hour session", "Weekly (all models)", "Weekly (Fable)"]);
    expect(windows.map((w) => w.percent)).toEqual([13, 67, 0]);
    expect(windows.map((w) => w.resetsAt)).toEqual([RESET_A, RESET_B, null]);
    expect(windows.map((w) => !!w.active)).toEqual([false, true, false]);
  });

  it("returns no windows for limits: [] even when the legacy five_hour / seven_day are present (Ultra guard)", () => {
    expect(windowsFrom({ ...legacyOnly, limits: [] })).toEqual([]);
  });

  it.each([
    ["null", { ...legacyOnly, limits: null }],
    ["absent", { ...legacyOnly }],
  ])("falls back to the legacy keys when limits is %s (old server)", (_name, json) => {
    const windows = windowsFrom(json);
    expect(windows.map((w) => w.label)).toEqual(["5-hour session", "Weekly (all models)"]);
    expect(windows.map((w) => w.percent)).toEqual([21, 44]);
    expect(windows.map((w) => w.resetsAt)).toEqual([RESET_A, RESET_B]);
  });

  it.each([
    ["with legacy five_hour present", { ...legacyOnly, limits: [row({})] }],
    ["without legacy keys", { limits: [row({})] }],
  ])("shows no 5-hour session window when the server sends no session row (%s)", (_name, json) => {
    const windows = windowsFrom(json);
    expect(windows.map((w) => w.label)).toEqual(["Weekly (all models)"]);
    expect(windows.some((w) => w.label === "5-hour session")).toBe(false);
  });

  describe("labels", () => {
    it.each([
      ["no group", { kind: "weekly_ultra", group: undefined, scope: null }],
      ["group weekly", { kind: "weekly_ultra", group: "weekly", scope: null }],
      ["scope absent", { kind: "weekly_ultra", scope: undefined }],
    ])("humanises an unknown kind (%s)", (_name, over) => {
      expect(windowsFrom({ limits: [row(over)] })[0]?.label).toBe("Weekly ultra");
    });

    it.each(["weekly_scoped", "weekly_surface"])("names a weekly row after its surface scope (kind %s)", (kind) => {
      const scope = { surface: { display_name: "Claude Code" } };
      expect(windowsFrom({ limits: [row({ kind, group: "weekly", scope })] })[0]?.label).toBe("Weekly (Claude Code)");
    });

    it("falls back to 'Limit' for a row with no kind", () => {
      expect(windowsFrom({ limits: [{ percent: 12, resets_at: null }] })[0]?.label).toBe("Limit");
    });
  });

  describe("severity", () => {
    it.each([
      [50, "critical"],
      [10, "warning"],
      [95, "normal"],
    ])("takes the server's grade as is (percent %d, severity %s)", (percent, severity) => {
      expect(windowsFrom({ limits: [row({ percent, severity })] })[0]?.severity).toBe(severity);
    });

    it.each([5, 75, 95])(
      "falls back to the percent-based grade for an unknown severity string (percent %d)",
      (percent) => {
        const expected = win("x", percent, null).severity;
        expect(windowsFrom({ limits: [row({ percent, severity: "catastrophic" })] })[0]?.severity).toBe(expected);
      },
    );

    it("falls back to the percent-based grade when the severity is missing", () => {
      const expected = win("x", 95, null).severity;
      expect(windowsFrom({ limits: [row({ percent: 95, severity: undefined })] })[0]?.severity).toBe(expected);
    });
  });

  it("keeps the order the server sent", () => {
    const limits = [
      row({ kind: "weekly_scoped", scope: { model: { display_name: "Fable" } }, is_active: false }),
      row({ kind: "weekly_all" }),
      row({ kind: "session", group: "session", is_active: false }),
    ];
    expect(windowsFrom({ limits }).map((w) => w.label)).toEqual([
      "Weekly (Fable)",
      "Weekly (all models)",
      "5-hour session",
    ]);
  });
});

describe("planLabel", () => {
  it.each([
    ["max", "default_claude_max_20x", "Max 20x"],
    ["max", "default_claude_max_5x", "Max 5x"],
    ["max", null, "Max"],
    ["ultra", null, "Ultra"],
    ["pro", null, "Pro"],
    [null, null, null],
    ["", null, null],
  ])("(%j, %j) -> %j", (subscriptionType, tier, expected) => {
    expect(planLabel(subscriptionType, tier)).toBe(expected);
  });
});

describe("provider.fetch", () => {
  const credentials = (oauth: Record<string, unknown>) => ({ claudeAiOauth: { accessToken: "test-token", ...oauth } });
  const respond = (body: unknown, status = 200) => vi.mocked(fetch).mockResolvedValue(Response.json(body, { status }));

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    vi.mocked(readJson).mockReturnValue(
      credentials({ subscriptionType: "max", rateLimitTier: "default_claude_max_20x" }),
    );
    vi.mocked(summarize).mockReturnValue({
      h5: { tokens: 2000, cost: 0.5, msgs: 3 },
      d7: { tokens: 3_000_000, cost: 12, msgs: 40 },
      models: {},
      files: 1,
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.resetAllMocks();
  });

  it("reports ok with no windows and an explanation when the server sends limits: []", async () => {
    respond({ ...legacyOnly, limits: [] });
    const result = await provider.fetch({});
    expect(result.status).toBe("ok");
    expect(result.windows).toEqual([]);
    expect(result.message).toBe("No usage limits reported for this plan.");
  });

  it("still labels the plan and keeps the local-log lines when limits is empty", async () => {
    vi.mocked(readJson).mockReturnValue(credentials({ subscriptionType: "ultra" }));
    respond({ limits: [] });
    const result = await provider.fetch({});
    expect(result.plan).toBe("Ultra");
    expect(result.extras.map((e) => e.label)).toEqual(["Local 5h", "Local 7d"]);
  });

  it.each([
    ["only null", [null]],
    ["only non-object rows", [null, 7, "session", [], true]],
  ])("treats a limits array with no usable rows (%s) like limits: []", async (_name, limits) => {
    respond({ ...legacyOnly, limits });
    const result = await provider.fetch({});
    expect(result.status).toBe("ok");
    expect(result.windows).toEqual([]);
    expect(result.message).toBe("No usage limits reported for this plan.");
  });

  it("does not add the empty-limits message when meters exist", async () => {
    respond(liveMax);
    const result = await provider.fetch({});
    expect(result.status).toBe("ok");
    expect(result.windows.map((w) => w.label)).toEqual(["5-hour session", "Weekly (all models)", "Weekly (Fable)"]);
    expect(result.message).toBeUndefined();
    expect(result.plan).toBe("Max 20x");
  });

  it("shows the legacy windows from an old server that sends no limits", async () => {
    respond(legacyOnly);
    const result = await provider.fetch({});
    expect(result.status).toBe("ok");
    expect(result.windows.map((w) => w.label)).toEqual(["5-hour session", "Weekly (all models)"]);
    expect(result.message).toBeUndefined();
  });

  it("reads the credentials through the mocked file and calls only the usage endpoint with the bearer token", async () => {
    respond(liveMax);
    await provider.fetch({});
    expect(readJson).toHaveBeenCalledWith(expect.stringContaining("C:/fake-home/.claude/.credentials.json"));
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://api.anthropic.com/api/oauth/usage",
      expect.objectContaining({ headers: expect.objectContaining({ Authorization: "Bearer test-token" }) }),
    );
  });

  it("asks the user to log in, without calling the network, when there are no credentials", async () => {
    vi.mocked(readJson).mockReturnValue(null);
    const result = await provider.fetch({});
    expect(result.status).toBe("not_logged_in");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("does not call the network with an expired token and never refreshes it", async () => {
    vi.mocked(readJson).mockReturnValue(credentials({ expiresAt: 1, subscriptionType: "pro" }));
    const result = await provider.fetch({});
    expect(result.status).toBe("expired");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("reports an expired login on HTTP 401 without echoing the token", async () => {
    respond({ error: "Bearer test-token" }, 401);
    const result = await provider.fetch({});
    expect(result.status).toBe("expired");
    expect(JSON.stringify(result)).not.toContain("test-token");
  });

  it("reports an error, not an empty ok card, when the usage endpoint fails", async () => {
    respond({}, 500);
    const result = await provider.fetch({});
    expect(result.status).toBe("error");
    expect(result.message).not.toBe("No usage limits reported for this plan.");
  });
});
