// Local fallback for Claude Code: sum token usage from ~/.claude/projects/**/*.jsonl.
// This is what ccusage does. It cannot tell you the remaining quota (only Anthropic knows
// that), but it works offline and when the OAuth token has expired.

import fs from "node:fs";
import { home, isObject, prop, str, walkFiles } from "./_util.ts";

/** $ per million tokens: [input, output, cache_read, cache_write_5m, cache_write_1h]. */
type Price = readonly [number, number, number, number, number];

// Source: claude-api skill model table (2026-06). Unknown models fall back to Opus rates.
const PRICES: Record<string, Price> = {
  "claude-opus-5": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-8": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-7": [5, 25, 0.5, 6.25, 10],
  "claude-opus-4-6": [5, 25, 0.5, 6.25, 10],
  "claude-sonnet-5": [2, 10, 0.2, 2.5, 4],
  "claude-sonnet-4-6": [3, 15, 0.3, 3.75, 6],
  "claude-haiku-4-5": [1, 5, 0.1, 1.25, 2],
  "claude-fable-5-1": [10, 50, 0.25, 12.5, 20],
  "claude-fable-5": [10, 50, 1, 12.5, 20],
};
const FALLBACK_PRICE = PRICES["claude-opus-5"] as Price;

/** The `usage` object on an assistant line of a Claude Code session log. */
export interface Usage {
  input_tokens?: number;
  output_tokens?: number;
  cache_read_input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_creation?: { ephemeral_5m_input_tokens?: number; ephemeral_1h_input_tokens?: number };
}

export function priceFor(model: string): Price {
  if (!model) return FALLBACK_PRICE;
  const key = Object.keys(PRICES).find((k) => model.startsWith(k));
  return (key && PRICES[key]) || FALLBACK_PRICE;
}

export function costOf(model: string, u: Usage): number {
  const [inp, out, cr, cw5, cw1] = priceFor(model);
  const cc = u.cache_creation ?? {};
  const w5 = cc.ephemeral_5m_input_tokens ?? u.cache_creation_input_tokens ?? 0;
  const w1 = cc.ephemeral_1h_input_tokens ?? 0;
  return (
    ((u.input_tokens ?? 0) * inp +
      (u.output_tokens ?? 0) * out +
      (u.cache_read_input_tokens ?? 0) * cr +
      w5 * cw5 +
      w1 * cw1) /
    1e6
  );
}

export function tokensOf(u: Usage): number {
  return (
    (u.input_tokens ?? 0) +
    (u.output_tokens ?? 0) +
    (u.cache_read_input_tokens ?? 0) +
    (u.cache_creation_input_tokens ?? 0)
  );
}

interface Entry {
  t: number;
  key: string;
  model: string;
  usage: Usage;
}

// Per-file cache keyed by path -> { mtimeMs, size, entries }
const cache = new Map<string, { mtimeMs: number; size: number; entries: Entry[] }>();

function usageOf(line: unknown): Entry | null {
  const message = prop(line, "message");
  const usage = prop(message, "usage");
  const timestamp = str(prop(line, "timestamp"));
  if (!isObject(usage) || !timestamp) return null;
  return {
    t: Date.parse(timestamp),
    key: `${str(prop(message, "id")) ?? ""}:${str(prop(line, "requestId")) ?? ""}`,
    model: str(prop(message, "model")) ?? "",
    usage: usage as Usage,
  };
}

function parseFile(file: string): Entry[] {
  let st: fs.Stats;
  try {
    st = fs.statSync(file);
  } catch {
    return [];
  }
  const hit = cache.get(file);
  if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.entries;

  const entries: Entry[] = [];
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    return [];
  }
  for (const line of text.split("\n")) {
    // Cheap pre-filter: only assistant lines carry usage.
    if (!line.includes('"type":"assistant"') || !line.includes('"usage"')) continue;
    try {
      const e = usageOf(JSON.parse(line));
      if (e) entries.push(e);
    } catch {
      /* partial line while Claude Code is writing */
    }
  }
  cache.set(file, { mtimeMs: st.mtimeMs, size: st.size, entries });
  return entries;
}

export interface Totals {
  tokens: number;
  cost: number;
  msgs: number;
}

export interface Summary {
  h5: Totals;
  d7: Totals;
  /** Cost per model id over the last 7 days. */
  models: Record<string, number>;
  files: number;
}

/**
 * Returns token + cost totals for the last 5 hours and 7 days.
 * Streaming writes several assistant lines per message with the same message.id+requestId;
 * the last one carries the final usage, so later duplicates overwrite earlier ones.
 */
export function summarize(): Summary {
  const now = Date.now();
  const since7d = now - 7 * 24 * 3600 * 1000;
  const since5h = now - 5 * 3600 * 1000;
  const root = home(".claude", "projects");
  const files = walkFiles(root, (p) => p.endsWith(".jsonl")).filter((f) => f.mtimeMs >= since7d);

  const byKey = new Map<string, Entry>();
  for (const f of files) {
    for (const e of parseFile(f.path)) {
      if (e.t < since7d) continue;
      byKey.set(e.key !== ":" ? e.key : `${f.path}:${e.t}`, e);
    }
  }

  const tot: Pick<Summary, "h5" | "d7"> = {
    h5: { tokens: 0, cost: 0, msgs: 0 },
    d7: { tokens: 0, cost: 0, msgs: 0 },
  };
  const models: Record<string, number> = {};
  for (const e of byKey.values()) {
    const tokens = tokensOf(e.usage);
    const cost = costOf(e.model, e.usage);
    tot.d7.tokens += tokens;
    tot.d7.cost += cost;
    tot.d7.msgs += 1;
    models[e.model] = (models[e.model] ?? 0) + cost;
    if (e.t >= since5h) {
      tot.h5.tokens += tokens;
      tot.h5.cost += cost;
      tot.h5.msgs += 1;
    }
  }
  return { ...tot, models, files: files.length };
}
