import { describe, expect, it } from "vitest";
import { DEFAULTS, merge, set } from "./config.ts";
import type { AppConfig } from "./types.ts";

describe("merge", () => {
  it("keeps defaults the user file does not mention", () => {
    const cfg = merge(DEFAULTS, { refreshMinutes: 10, providers: { openrouter: { apiKey: "k" } } });
    expect(cfg.refreshMinutes).toBe(10);
    expect(cfg.notifyAtPercent).toBe(DEFAULTS.notifyAtPercent);
    expect(cfg.providers.openrouter).toEqual({ enabled: true, apiKey: "k" });
    expect(cfg.providers.claude).toEqual({ enabled: true });
  });
  it("does not mutate the defaults", () => {
    const before = structuredClone(DEFAULTS);
    merge(DEFAULTS, { providers: { claude: { enabled: false } } });
    expect(DEFAULTS).toEqual(before);
  });
  it("ignores a user file that is not an object", () => {
    expect(merge(DEFAULTS, null)).toEqual(DEFAULTS);
    expect(merge(DEFAULTS, [1, 2])).toEqual(DEFAULTS);
  });
});

describe("set", () => {
  it("writes through a dotted path, creating missing objects", () => {
    const cfg: AppConfig = structuredClone(DEFAULTS);
    set(cfg, "providers.newone.apiKey", "x");
    set(cfg, "refreshMinutes", 7);
    expect(cfg.providers.newone?.apiKey).toBe("x");
    expect(cfg.refreshMinutes).toBe(7);
  });
  it("replaces a non-object in the middle of the path", () => {
    const cfg = structuredClone(DEFAULTS) as AppConfig & { flag?: unknown };
    cfg.flag = true;
    set(cfg, "flag.inner", 1);
    expect(cfg.flag).toEqual({ inner: 1 });
  });
});
