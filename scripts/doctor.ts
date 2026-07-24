import { spawnSync } from "node:child_process";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

import { BROWSER_CANDIDATES } from "../server/preview-capture.ts";
import { getVersionInfo } from "../server/version.ts";

export type DoctorStatus = "pass" | "warn" | "fail";

export interface DoctorCheck {
  name: string;
  status: DoctorStatus;
  message: string;
  detail?: string;
}

export function exitCodeFor(checks: DoctorCheck[]): number {
  return checks.some((check) => check.status === "fail") ? 1 : 0;
}

export function formatCheck(check: DoctorCheck): string {
  const icon = check.status === "pass" ? "OK" : check.status === "warn" ? "WARN" : "FAIL";
  return `${icon.padEnd(4)} ${check.name}: ${check.message}${check.detail ? `\n     ${check.detail}` : ""}`;
}

function commandExists(command: string): boolean {
  const result = spawnSync("sh", ["-c", `command -v "$1" >/dev/null 2>&1`, "sh", command], { stdio: "ignore" });
  return result.status === 0;
}

function commandOutput(command: string, args: string[]): string | null {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) return null;
  return result.stdout.trim() || result.stderr.trim() || null;
}

function checkBun(): DoctorCheck {
  const version = process.versions.bun;
  if (!version) return { name: "Bun runtime", status: "fail", message: "doctor must run under Bun" };
  return { name: "Bun runtime", status: "pass", message: version };
}

function checkNodePty(): DoctorCheck {
  if (!commandExists("node")) {
    return {
      name: "Terminal sidecar",
      status: "fail",
      message: "node is not on PATH",
      detail: "Install Node.js; Bureau's PTY sidecar runs node-pty under Node because Bun is not compatible with node-pty's native binding.",
    };
  }
  const nodeVersion = commandOutput("node", ["--version"]) ?? "node";
  const result = spawnSync("node", ["-e", "require('node-pty');"], {
    cwd: join(import.meta.dir, ".."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status === 0) {
    return { name: "Terminal sidecar", status: "pass", message: `node-pty loads under ${nodeVersion}` };
  }
  return {
    name: "Terminal sidecar",
    status: "fail",
    message: "node-pty could not be loaded by Node",
    detail: "Run `bun install` after installing build dependencies. On fresh Ubuntu: `sudo apt-get install -y build-essential python3 make g++ nodejs`.",
  };
}

function checkPreviewBrowser(): DoctorCheck {
  const found = BROWSER_CANDIDATES.find(commandExists);
  if (found) return { name: "Browser preview", status: "pass", message: `${found} found` };
  return {
    name: "Browser preview",
    status: "warn",
    message: "no Chrome-family browser found",
    detail: `Install one of: ${BROWSER_CANDIDATES.join(", ")}. Browser preview cards are optional; Bureau still runs without them.`,
  };
}

function checkBureauHome(): DoctorCheck {
  const dir = process.env.BUREAU_HOME || join(homedir(), ".bureau");
  const probe = join(dir, `.doctor-${process.pid}`);
  try {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    writeFileSync(probe, "ok\n", { mode: 0o600 });
    rmSync(probe, { force: true });
    return { name: "State directory", status: "pass", message: `${dir} is writable` };
  } catch (err) {
    return {
      name: "State directory",
      status: "fail",
      message: `${dir} is not writable`,
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

function checkGitVersion(): DoctorCheck {
  const info = getVersionInfo();
  if (info.commit === "unknown") {
    return {
      name: "Git metadata",
      status: "warn",
      message: "current commit could not be resolved",
      detail: "Update notices need a git checkout with commit metadata.",
    };
  }
  const short = info.commit.slice(0, 7);
  return { name: "Git metadata", status: "pass", message: `${info.version} (${short})` };
}

export function runDoctor(): DoctorCheck[] {
  return [checkBun(), checkNodePty(), checkPreviewBrowser(), checkBureauHome(), checkGitVersion()];
}

if (import.meta.main) {
  const checks = runDoctor();
  for (const check of checks) {
    console.log(formatCheck(check));
  }
  process.exit(exitCodeFor(checks));
}
