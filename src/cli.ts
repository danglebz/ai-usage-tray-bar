#!/usr/bin/env node
// Terminal probe: `pnpm probe` (all providers) or `pnpm probe claude codex`.
// Prints the same snapshots the tray shows, so a provider can be debugged without the GUI.

import * as config from "./config.ts";
import { fetchAll, providers } from "./providers/index.ts";

function fmtReset(iso: string | null): string {
  if (!iso) return "";
  const ms = new Date(iso).getTime() - Date.now();
  if (ms <= 0) return "resets now";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  return h >= 48 ? `resets in ${Math.round(h / 24)}d` : `resets in ${h}h ${m}m`;
}

function bar(p: number | null): string {
  if (p == null) return "  ---  ";
  const n = Math.round(p / 5);
  return "█".repeat(n) + "░".repeat(20 - n);
}

async function main(): Promise<void> {
  const cfg = config.load();
  const only = process.argv.slice(2);
  if (only.length) {
    for (const p of providers) config.set(cfg, `providers.${p.id}.enabled`, only.includes(p.id));
  }
  const results = await fetchAll(cfg);
  for (const r of results) {
    const head = [
      r.name,
      r.plan ? `(${r.plan})` : "",
      r.account ? `<${r.account}>` : "",
      `[${r.status}${r.source === "local" ? ", local" : ""}, ${r.ms}ms]`,
    ]
      .filter(Boolean)
      .join(" ");
    console.log(`\n${head}`);
    if (r.message) console.log(`  ${r.message}`);
    for (const w of r.windows) {
      const pct = w.percent == null ? "  ?%" : `${String(Math.round(w.percent)).padStart(3)}%`;
      console.log(`  ${bar(w.percent)} ${pct}  ${w.label}${w.detail ? ` (${w.detail})` : ""}  ${fmtReset(w.resetsAt)}`);
    }
    for (const x of r.extras) console.log(`  · ${x.label}: ${x.value}`);
  }
  console.log(`\nconfig: ${config.configPath()}`);
}

main().catch((e: unknown) => {
  console.error(e);
  process.exit(1);
});
