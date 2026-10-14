// Provider registry. Order here is the order of the cards in the panel.

import type { AppConfig, Provider, ProviderResult } from "../types.ts";
import anthropicApi from "./anthropic-api.ts";
import claude from "./claude.ts";
import codex from "./codex.ts";
import copilot from "./copilot.ts";
import gemini from "./gemini.ts";
import openaiApi from "./openai-api.ts";
import openrouter from "./openrouter.ts";

export const providers: readonly Provider[] = [claude, codex, copilot, gemini, openrouter, anthropicApi, openaiApi];

export const byId: Readonly<Record<string, Provider>> = Object.fromEntries(providers.map((p) => [p.id, p]));

/** Fetch every enabled provider in parallel. A provider that throws becomes an error snapshot. */
export async function fetchAll(config: AppConfig): Promise<ProviderResult[]> {
  const enabled = providers.filter((p) => config.providers[p.id]?.enabled !== false);
  return Promise.all(
    enabled.map(async (p): Promise<ProviderResult> => {
      const t0 = Date.now();
      let s;
      try {
        s = await p.fetch(config.providers[p.id] ?? {});
      } catch (e) {
        s = {
          status: "error" as const,
          message: `Provider crashed: ${(e as Error).message}`,
          windows: [],
          extras: [],
          fetchedAt: new Date().toISOString(),
        };
      }
      return { id: p.id, name: p.name, ms: Date.now() - t0, ...s };
    }),
  );
}
