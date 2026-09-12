import { describe, expect, it } from "vitest";
import { costOf, priceFor, tokensOf } from "./claude-local.ts";

describe("priceFor", () => {
  it("matches by model id prefix and falls back to Opus", () => {
    expect(priceFor("claude-sonnet-5-20260101")[0]).toBe(2);
    expect(priceFor("claude-haiku-4-5-20251001")[1]).toBe(5);
    expect(priceFor("something-new")).toEqual(priceFor("claude-opus-5"));
    expect(priceFor("")).toEqual(priceFor("claude-opus-5"));
  });
});

describe("costOf", () => {
  it("prices each token class at its own rate, per million", () => {
    // Sonnet 5: $2 in, $10 out, $0.20 cache read, $2.50 5m write, $4 1h write.
    const cost = costOf("claude-sonnet-5", {
      input_tokens: 1_000_000,
      output_tokens: 100_000,
      cache_read_input_tokens: 500_000,
      cache_creation: { ephemeral_5m_input_tokens: 200_000, ephemeral_1h_input_tokens: 100_000 },
    });
    expect(cost.toFixed(2)).toBe((2 + 1 + 0.1 + 0.5 + 0.4).toFixed(2));
  });
  it("uses the legacy cache_creation_input_tokens field when the breakdown is missing", () => {
    const cost = costOf("claude-sonnet-5", { cache_creation_input_tokens: 1_000_000 });
    expect(cost).toBe(2.5);
  });
  it("treats missing counters as zero", () => {
    expect(costOf("claude-opus-5", {})).toBe(0);
    expect(tokensOf({})).toBe(0);
  });
});

describe("tokensOf", () => {
  it("sums every token class", () => {
    expect(
      tokensOf({ input_tokens: 1, output_tokens: 2, cache_read_input_tokens: 3, cache_creation_input_tokens: 4 }),
    ).toBe(10);
  });
});
