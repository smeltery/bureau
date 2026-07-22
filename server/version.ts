import { execFileSync } from "node:child_process";

export interface VersionInfo {
  version: string;
  commit: string;
  release: string | null;
}

export type GitRunner = (args: string[]) => string;

const CALVER_TAG = /^v\d{4}\.\d{1,2}\.\d{1,2}(?:\.\d+)?$/;

function runGit(args: string[]): string {
  return execFileSync("git", args, { cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

function gitOrUnknown(run: GitRunner, args: string[]): string {
  try {
    return run(args).trim() || "unknown";
  } catch {
    return "unknown";
  }
}

export function resolveVersionInfo(run: GitRunner = runGit): VersionInfo {
  const version = gitOrUnknown(run, ["describe", "--tags", "--always", "--dirty", "--match", "v*"]);
  const commit = gitOrUnknown(run, ["rev-parse", "HEAD"]);
  const exactTag = gitOrUnknown(run, ["describe", "--tags", "--exact-match", "--match", "v*"]);

  return {
    version,
    commit,
    release: CALVER_TAG.test(exactTag) ? exactTag : null,
  };
}

let cachedVersionInfo: VersionInfo | null = null;

export function getVersionInfo(): VersionInfo {
  cachedVersionInfo ??= resolveVersionInfo();
  return cachedVersionInfo;
}
