import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { railwayBinary, readRailwayUsage } from "./content-automation-railway.ts";

vi.mock("node:child_process", () => ({ execFile: vi.fn() }));
let folder: string;
beforeEach(() => {
  folder = fs.mkdtempSync(path.join(os.tmpdir(), "railway-usage-"));
  fs.writeFileSync(path.join(folder, process.platform === "win32" ? "railway.exe" : "railway"), "");
  vi.stubEnv("PATH", folder);
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetAllMocks();
  fs.rmSync(folder, { recursive: true, force: true });
});

it("finds the native CLI installed via npm without executing a shell shim", () => {
  const binDir = path.join(folder, "node_modules", "@railway", "cli", "bin");
  fs.mkdirSync(binDir, { recursive: true });
  const bin = process.platform === "win32" ? "railway.exe" : "railway";
  fs.rmSync(path.join(folder, bin));
  fs.writeFileSync(path.join(binDir, bin), "");
  expect(railwayBinary()).toBe(path.join(binDir, bin));
});

it("sends only code over SSH and uses the deployed runtime environment", async () => {
  vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as (error: null, stdout: string, stderr: string) => void;
    callback(null, 'banner\n{"month":"2026-10","providers":[]}\n', "");
    return {} as ReturnType<typeof execFile>;
  });
  const source = { projectPath: folder, environment: "main", service: "Frontend", projectId: "project-id" };
  expect((await readRailwayUsage(source)).month).toBe("2026-10");
  const call = vi.mocked(execFile).mock.calls[0]!;
  expect(call[1]).toEqual(
    expect.arrayContaining(["--project", "project-id", "--environment", "main", "--service", "Frontend"]),
  );
  const args = call[1] as string[];
  const command = args.at(-1)!;
  const encoded = command.match(/Buffer\.from\("([A-Za-z0-9+/=]+)"/)?.[1];
  expect(encoded).toBeTruthy();
  const program = Buffer.from(encoded!, "base64").toString();
  expect(program).toContain("READ ONLY");
  expect(program).toContain("process.env");
  expect(program).not.toContain('from "./_util.ts"');
  expect(call[2]).toMatchObject({ windowsHide: true, timeout: 30000 });
});

it("reports missing SSH setup without returning raw child errors", async () => {
  vi.mocked(execFile).mockImplementation((...args: unknown[]) => {
    const callback = args.at(-1) as (error: Error, stdout: string, stderr: string) => void;
    callback(new Error("secret connection string"), "", "No registered SSH keys found.");
    return {} as ReturnType<typeof execFile>;
  });
  await expect(readRailwayUsage({ projectPath: folder, environment: "main", service: "Frontend" })).rejects.toThrow(
    "SSH public key",
  );
});
