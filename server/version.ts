import { execFileSync } from "node:child_process";

export interface VersionInfo {
  version: string;
  commit: string;
  release: string | null;
}

export type GitRunner = (args: string[]) => string;

export const CALVER_TAG = /^v\d{4}\.\d{1,2}\.\d{1,2}(?:\.\d+)?$/;

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
  const exactTag = pickLatestCalverTag(gitOrUnknown(run, ["tag", "--points-at", "HEAD"]));

  return {
    version,
    commit,
    release: exactTag,
  };
}

export function resolveReachableRelease(run: GitRunner = runGit): string | null {
  return pickLatestCalverTag(gitOrUnknown(run, ["tag", "--merged", "HEAD", "--list", "v*"]));
}

function pickLatestCalverTag(output: string): string | null {
  return (
    output
      .split("\n")
      .map((tag) => tag.trim())
      .filter((tag) => CALVER_TAG.test(tag))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
      .at(-1) ?? null
  );
}

let cachedVersionInfo: VersionInfo | null = null;
let cachedReachableRelease: string | null | undefined;

export function getVersionInfo(): VersionInfo {
  cachedVersionInfo ??= resolveVersionInfo();
  return cachedVersionInfo;
}

export function getReachableRelease(): string | null {
  if (cachedReachableRelease === undefined) {
    cachedReachableRelease = resolveReachableRelease();
  }
  return cachedReachableRelease;
}
