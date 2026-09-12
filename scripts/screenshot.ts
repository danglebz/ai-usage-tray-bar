// Renders the README image of the panel from demo data, so no real account, key or token ends
// up in the repository. Run with `pnpm screenshot`. (The Settings view is not rendered: it
// reflects this machine's config.json rather than the demo data.)

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const outDir = path.join(root, "docs");
const electron = path.join(
  root,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);

fs.mkdirSync(outDir, { recursive: true });

const shots: Array<{ file: string; env: NodeJS.ProcessEnv }> = [{ file: "screenshot.png", env: {} }];

for (const { file, env } of shots) {
  const target = path.join(outDir, file);
  // ELECTRON_RUN_AS_NODE is exported by some editors' terminals and would make electron.exe
  // run as plain Node, which dies on the first Electron API call.
  const clean: NodeJS.ProcessEnv = { ...process.env, ...env, AI_USAGE_DEMO: "1", AI_USAGE_SCREENSHOT: target };
  delete clean.ELECTRON_RUN_AS_NODE;
  const r = spawnSync(electron, [root], {
    env: clean,
    stdio: "inherit",
    timeout: 60_000,
  });
  if (r.status !== 0 || !fs.existsSync(target)) {
    console.error(`screenshot failed for ${file} (exit ${r.status}); see the Electron output above`);
    process.exit(1);
  }
  console.log("wrote", path.relative(root, target));
}
