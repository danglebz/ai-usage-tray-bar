// Launch smoke test for CI: starts the real app in demo + screenshot mode and checks that it
// exits 0 and leaves a PNG behind. Type-check, lint and unit tests never start Electron, so an
// Electron upgrade that breaks the app at runtime would otherwise pass CI.
//
// Run with `pnpm smoke`, or `node scripts/smoke.ts <appDir>` to point it at another app
// directory (used to prove that a broken app is caught). It is not part of `pnpm verify`: the
// Definition-of-Done gate runs that, and it must not open windows.
//
// On failure the app's own screenshot log (AI_USAGE_SCREENSHOT_LOG) is printed to stderr:
// Electron's stdout and stderr do not reach a Windows CI log, so that file is the only
// account of why a capture came out blank.
//
// SMOKE_ARTIFACT_DIR=<dir>: when the check fails, the PNG and that log, whichever exist, are
// copied into <dir> (CI uploads it), so a bad screenshot can be looked at instead of guessed
// from its byte size. Unset, nothing leaves the temp directory.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TIMEOUT_MS = 60_000;
// The demo panel is ~55 KB. A blank or half-rendered window compresses to a couple of KB, so
// this catches "exited 0 but drew nothing" without being sensitive to font or layout changes.
const MIN_PNG_BYTES = 10_000;
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const root = path.resolve(import.meta.dirname, "..");
const appDir = path.resolve(process.argv[2] ?? root);
// Always the repository's Electron, whatever appDir is: appDir is only the app to load.
const electron = path.join(
  root,
  "node_modules",
  "electron",
  "dist",
  process.platform === "win32" ? "electron.exe" : "electron",
);

/** Launches the app and returns the success line; throws with the one-line failure reason. */
function smoke(png: string, log: string): string {
  if (!fs.existsSync(appDir)) throw new Error(`app directory not found: ${appDir}`);

  // ELECTRON_RUN_AS_NODE is exported by some editors' terminals and would make electron.exe
  // run as plain Node, which dies on the first Electron API call.
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AI_USAGE_DEMO: "1",
    AI_USAGE_SCREENSHOT: png,
    AI_USAGE_SCREENSHOT_LOG: log,
  };
  delete env.ELECTRON_RUN_AS_NODE;

  const r = spawnSync(electron, [appDir], { env, stdio: "inherit", timeout: TIMEOUT_MS });
  if (r.error) {
    const timedOut = "code" in r.error && r.error.code === "ETIMEDOUT";
    throw new Error(
      timedOut ? `electron did not exit within ${TIMEOUT_MS / 1000} s` : `could not run electron: ${r.error.message}`,
    );
  }
  if (r.status !== 0) throw new Error(`electron exited with ${r.signal ?? `code ${r.status}`}`);

  if (!fs.existsSync(png)) throw new Error("electron exited 0 but wrote no screenshot");
  const bytes = fs.readFileSync(png);
  if (!bytes.subarray(0, PNG_SIGNATURE.length).equals(PNG_SIGNATURE))
    throw new Error(`${png} is not a PNG (bad signature)`);
  if (bytes.length < MIN_PNG_BYTES)
    throw new Error(`${png} is only ${bytes.length} bytes (expected at least ${MIN_PNG_BYTES})`);
  return `smoke ok: ${bytes.length}-byte PNG written to ${png}, removed afterwards`;
}

/** Prints the app's own log after a failure. Best effort: it must never hide the real failure. */
function showLog(log: string): void {
  try {
    const text = fs.readFileSync(log, "utf8").trim();
    if (text)
      console.error(`--- app screenshot log ---
${text}`);
  } catch {
    // No log file: the app died before it wrote one, or never started.
  }
}

/** Copies a failed run's files to SMOKE_ARTIFACT_DIR. Best effort, like showLog. */
function keepFiles(files: string[]): void {
  const out = process.env.SMOKE_ARTIFACT_DIR;
  const present = files.filter((f) => fs.existsSync(f));
  if (!out || present.length === 0) return;
  try {
    fs.mkdirSync(out, { recursive: true });
    for (const f of present) fs.copyFileSync(f, path.join(out, path.basename(f)));
    console.log(`smoke: kept ${present.map((f) => path.basename(f)).join(" and ")} in ${out}`);
  } catch (e) {
    console.error(`smoke: could not keep the failure files: ${e instanceof Error ? e.message : String(e)}`);
  }
}

// A fresh directory per run, so a PNG left by an earlier run can never make this one pass, and
// nothing is written into the repository.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-usage-smoke-"));
const png = path.join(dir, "panel.png");
const log = path.join(dir, "screenshot.log");
try {
  console.log(smoke(png, log));
} catch (e) {
  console.error(`smoke failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exitCode = 1;
  showLog(log);
  keepFiles([png, log]);
} finally {
  fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
}
