import { describe, expect, it } from "vitest";
import { decodeJwt, pct, severity, snap, toIso, usd, win, windowLabel } from "./_util.ts";

describe("pct", () => {
  it("clamps into [0, 100] and rounds to one decimal", () => {
    expect(pct(42.26)).toBe(42.3);
    expect(pct(-5)).toBe(0);
    expect(pct(140)).toBe(100);
    expect(pct("12.5")).toBe(12.5);
  });
  it("passes null and non-numbers through as null", () => {
    expect(pct(null)).toBeNull();
    expect(pct(undefined)).toBeNull();
    expect(pct("abc")).toBeNull();
  });
});

describe("toIso", () => {
  it("accepts unix seconds, unix milliseconds and ISO strings", () => {
    expect(toIso(1_700_000_000)).toBe("2023-11-14T22:13:20.000Z");
    expect(toIso(1_700_000_000_000)).toBe("2023-11-14T22:13:20.000Z");
    expect(toIso("2023-11-14T22:13:20Z")).toBe("2023-11-14T22:13:20.000Z");
  });
  it("returns null for unknown or unparsable values", () => {
    expect(toIso(null)).toBeNull();
    expect(toIso("not a date")).toBeNull();
    expect(toIso({})).toBeNull();
  });
});

describe("windowLabel", () => {
  it("names the common windows", () => {
    expect(windowLabel(5 * 3600)).toBe("5-hour");
    expect(windowLabel(7 * 24 * 3600)).toBe("Weekly");
    expect(windowLabel(24 * 3600)).toBe("Daily");
    expect(windowLabel(30 * 24 * 3600)).toBe("30-day");
    expect(windowLabel(2 * 3600)).toBe("2-hour");
  });
  it("falls back to a generic label", () => {
    expect(windowLabel(null)).toBe("Window");
    expect(windowLabel(0)).toBe("Window");
  });
});

describe("severity", () => {
  it("buckets by used percent", () => {
    expect(severity(null)).toBe("unknown");
    expect(severity(0)).toBe("normal");
    expect(severity(69.9)).toBe("normal");
    expect(severity(70)).toBe("warning");
    expect(severity(90)).toBe("critical");
  });
});

describe("win", () => {
  it("builds a window with derived severity and normalised reset time", () => {
    expect(win("Weekly", 91.26, 1_700_000_000, { detail: "x" })).toEqual({
      label: "Weekly",
      percent: 91.3,
      resetsAt: "2023-11-14T22:13:20.000Z",
      severity: "critical",
      detail: "x",
    });
  });
});

describe("snap", () => {
  it("fills the shared shape for every status", () => {
    const ok = snap.ok({ plan: "max" });
    expect(ok.status).toBe("ok");
    expect(ok.source).toBe("api");
    expect(ok.windows).toEqual([]);
    expect(ok.extras).toEqual([]);
    expect(ok.plan).toBe("max");
    expect(ok.fetchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const expired = snap.expired("stale", { source: "local" });
    expect(expired.status).toBe("expired");
    expect(expired.message).toBe("stale");
    expect(expired.source).toBe("local");
    expect(snap.notConfigured("m").status).toBe("not_configured");
    expect(snap.notLoggedIn("m").status).toBe("not_logged_in");
    expect(snap.error("m").status).toBe("error");
  });
});

describe("usd", () => {
  it("formats dollars and marks unknown amounts", () => {
    expect(usd(1.5)).toBe("$1.50");
    expect(usd("2")).toBe("$2.00");
    expect(usd(null)).toBe("?");
    expect(usd("abc")).toBe("?");
  });
});

describe("decodeJwt", () => {
  it("decodes the payload without verifying", () => {
    const payload = Buffer.from(JSON.stringify({ exp: 123, email: "a@b.c" })).toString("base64url");
    expect(decodeJwt(`hdr.${payload}.sig`)).toEqual({ exp: 123, email: "a@b.c" });
  });
  it("returns null for garbage", () => {
    expect(decodeJwt("nope")).toBeNull();
    expect(decodeJwt(null)).toBeNull();
  });
});
