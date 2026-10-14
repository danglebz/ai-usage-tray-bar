import { afterEach, expect, it, vi } from "vitest";
import { monthlyProgress } from "./_progress.ts";
import { usd } from "./_util.ts";

afterEach(() => vi.useRealTimers());

it("compares usage with a local target and resets at the next UTC month", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-12-31T23:30:00Z"));
  const result = monthlyProgress("Monthly spend", 2, "10", usd);
  expect(result.label).toContain("local target");
  expect(result.percent).toBe(20);
  expect(result.detail).toBe("$2.00 / $10.00 · $8.00 left");
  expect(result.resetsAt).toBe("2027-01-01T00:00:00.000Z");
});

it.each([undefined, null, "", "invalid", 0, -1, Infinity])(
  "keeps the percentage unknown for an invalid or missing target: %s",
  (target) => {
    const result = monthlyProgress("Monthly requests", 4786, target);
    expect(result.percent).toBeNull();
    expect(result.detail).toContain("4,786 used");
    expect(result.detail).not.toContain("left");
  },
);

it("never turns unavailable usage into zero even when a target exists", () => {
  const result = monthlyProgress("Monthly tokens", null, 1000000);
  expect(result.percent).toBeNull();
  expect(result.detail).toBe("Usage not reported · Target 1,000,000");
});

it("caps an exceeded target without hiding the actual usage amount", () => {
  const result = monthlyProgress("Monthly requests", 120, 100);
  expect(result.percent).toBe(100);
  expect(result.severity).toBe("critical");
  expect(result.detail).toBe("120 / 100 · 0 left");
});
