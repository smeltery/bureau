import { execFileSync } from "node:child_process";

export interface VersionInfo {
  version: string | null;
  commit: string | null;
  release: string | null;
}

export type GitRunner = (args: string[]) => string;
export type VersionSource = "git" | "image" | null;

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

function renderVersion(env: Record<string, string | undefined>): VersionInfo {
  const commit = env.RENDER_GIT_COMMIT;
  if (env.RENDER !== "true" || !commit || !/^[a-f0-9]{40}$/.test(commit)) {
    return { version: null, commit: null, release: null };
  }
  return { version: commit, commit, release: null };
}

export function resolveVersion(run: GitRunner = runGit, env: Record<string, string | undefined> = process.env): { info: VersionInfo; source: VersionSource } {
  const version = gitOrUnknown(run, ["describe", "--tags", "--always", "--dirty", "--match", "v*"]);
  const commit = gitOrUnknown(run, ["rev-parse", "HEAD"]);
  const exactTag = pickLatestCalverTag(gitOrUnknown(run, ["tag", "--points-at", "HEAD"]));

  if (commit === "unknown") {
    const render = renderVersion(env);
    return { info: render.commit ? render : { version: null, commit: null, release: null }, source: render.commit ? "image" : null };
  }

  return {
    info: {
      version,
      commit,
      release: exactTag,
    },
    source: "git",
  };
}

export function resolveVersionInfo(run: GitRunner = runGit, env: Record<string, string | undefined> = process.env): VersionInfo {
  return resolveVersion(run, env).info;
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

let cachedVersion: { info: VersionInfo; source: VersionSource } | null = null;
let cachedReachableRelease: string | null | undefined;

export function getVersionInfo(): VersionInfo {
  cachedVersion ??= resolveVersion();
  return cachedVersion.info;
}

export function getVersionSource(): VersionSource {
  cachedVersion ??= resolveVersion();
  return cachedVersion.source;
}

export function getReachableRelease(): string | null {
  if (cachedReachableRelease === undefined) {
    cachedReachableRelease = resolveReachableRelease();
  }
  return cachedReachableRelease;
}
