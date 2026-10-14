// Sample results for AI_USAGE_DEMO=1: the panel with believable numbers and no real account,
// key label or token behind them. Used for the README screenshot (`pnpm screenshot`) and for
// working on the panel without being logged in to anything.

import type { ProviderResult } from "./types.ts";
import { win } from "./providers/_util.ts";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function fromNow(ms: number): string {
  return new Date(Date.now() + ms).toISOString();
}

export function demoResults(): ProviderResult[] {
  const fetchedAt = new Date().toISOString();
  return [
    {
      id: "claude",
      name: "Claude Code",
      ms: 412,
      status: "ok",
      source: "api",
      plan: "Max",
      windows: [
        win("5-hour session", 42, fromNow(2 * HOUR + 15 * 60_000)),
        win("Weekly (all models)", 68, fromNow(3 * DAY + 4 * HOUR)),
        win("Weekly (Opus)", 91, fromNow(3 * DAY + 4 * HOUR)),
      ],
      extras: [
        { label: "Local 5h", value: "12.4M tok · ~$9.80" },
        { label: "Local 7d", value: "210.6M tok · ~$168.20" },
      ],
      fetchedAt,
    },
    {
      id: "codex",
      name: "Codex",
      ms: 388,
      status: "ok",
      source: "api",
      plan: "Plus",
      account: "you@example.com",
      windows: [win("5-hour", 23, fromNow(4 * HOUR + 2 * 60_000)), win("Weekly", 57, fromNow(5 * DAY + 9 * HOUR))],
      extras: [],
      fetchedAt,
    },
    {
      id: "copilot",
      name: "GitHub Copilot",
      ms: 265,
      status: "ok",
      source: "api",
      plan: "Pro",
      account: "octocat",
      windows: [win("Premium requests", 74, fromNow(12 * DAY), { detail: "78 / 300 left" })],
      extras: [{ label: "Token from", value: "apps.json" }],
      fetchedAt,
    },
    {
      id: "openrouter",
      name: "OpenRouter",
      ms: 198,
      status: "ok",
      source: "api",
      account: "my-key",
      windows: [win("Credits used", 38, null, { detail: "$12.40 left" })],
      extras: [
        { label: "Balance", value: "$12.40" },
        { label: "Lifetime", value: "$7.60 used of $20.00" },
        { label: "Today", value: "$0.85" },
        { label: "This week", value: "$3.10" },
        { label: "This month", value: "$7.60" },
      ],
      fetchedAt,
    },
  ];
}
