// Run the same read-only collector beside the deployed app, over the user's Railway
// SSH login. No deployment, public database proxy, or downloaded secrets are needed.
import { execFile } from "node:child_process";
import fs from "node:fs";
import { stripTypeScriptTypes } from "node:module";
import path from "node:path";
import type { ProjectUsage } from "./content-automation-source.ts";

export interface RailwaySource {
  projectPath: string;
  environment: string;
  service: string;
  projectId?: string;
}

export function railwayBinary(searchPath = process.env.PATH ?? ""): string | null {
  const binary = process.platform === "win32" ? "railway.exe" : "railway";
  for (const dir of searchPath.split(path.delimiter).filter(Boolean)) {
    for (const candidate of [
      path.join(dir, binary),
      path.join(dir, "node_modules", "@railway", "cli", "bin", binary),
    ]) {
      if (fs.existsSync(candidate)) return candidate;
    }
  }
  return null;
}

export async function readRailwayUsage(source: RailwaySource): Promise<ProjectUsage> {
  const binary = railwayBinary();
  if (!binary) throw new Error("Install the Railway CLI and sign in to read deployed project usage.");
  if (!path.isAbsolute(source.projectPath)) throw new Error("Choose the absolute Content Automation project folder.");
  if (!source.environment || !source.service) throw new Error("Choose a Railway environment and service.");

  const collector = stripTypeScriptTypes(
    fs.readFileSync(new URL("./content-automation-source.ts", import.meta.url), "utf8"),
  );
  const program = `${collector}\nconsole.log(JSON.stringify(await readProjectUsage(process.cwd(), ${JSON.stringify(`Railway / ${source.environment}`)}, new Date(), process.env)));`;
  // Railway forwards the command through a remote shell. This argument contains only
  // base64 and fixed syntax: project names and env values cannot become shell commands.
  const command = `'eval(Buffer.from("${Buffer.from(program).toString("base64")}","base64").toString())'`;
  const args = ["ssh", "--environment", source.environment, "--service", source.service];
  if (source.projectId) args.push("--project", source.projectId);
  args.push("--", "node", "--input-type=module", "-e", command);
  return new Promise((resolve, reject) => {
    execFile(
      binary,
      args,
      { cwd: source.projectPath, windowsHide: true, timeout: 30_000, maxBuffer: 256 * 1024 },
      (error, stdout, stderr) => {
        if (error) {
          // CLI stderr and child errors are never returned verbatim; commands can include
          // connection details. Only recognize the setup issue observed on this machine.
          const noKey = stderr.includes("No registered SSH keys");
          reject(
            new Error(
              noKey
                ? "Register this machine's SSH public key with Railway to read deployed usage."
                : "Railway usage read failed. Check CLI login, SSH access, environment and service.",
            ),
          );
          return;
        }
        try {
          // Only the last line is the collector's JSON. Never render SSH banners or errors.
          const line = stdout.trim().split(/\r?\n/).at(-1) ?? "";
          resolve(JSON.parse(line) as ProjectUsage);
        } catch {
          reject(new Error("Railway returned no valid project usage report."));
        }
      },
    );
  });
}
