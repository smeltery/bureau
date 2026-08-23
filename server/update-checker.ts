import type { LatestRelease, UpdateStatusWire } from "../shared/update-types.ts";
import { CALVER_TAG, getReachableRelease, getVersionInfo } from "./version.ts";

const REPO = "smeltery/bureau";
const DEFAULT_BRANCH = "master";
const CHECK_INTERVAL = 60 * 60 * 1000; // 1 hour

type CompareResult = { aheadBy: number; behindBy: number } | "unknown";

let status: UpdateStatusWire = {
  mode: "commit",
  updateAvailable: false,
  current: { release: null, sha: "" },
  latest: null,
  releaseStanding: "unknown",
  mainAhead: 0,
};

let onChange: ((s: UpdateStatusWire) => void) | null = null;

export function latestCommitUrl(repo = REPO, branch = DEFAULT_BRANCH): string {
  return `https://api.github.com/repos/${repo}/commits/${branch}`;
}

export function latestReleaseUrl(repo = REPO): string {
  return `https://api.github.com/repos/${repo}/releases/latest`;
}

export function compareUrl(repo = REPO, base: string, branch = DEFAULT_BRANCH): string {
  return `https://api.github.com/repos/${repo}/compare/${encodeURIComponent(base)}...heads/${branch}?per_page=1`;
}

export function compareCalver(a: string, b: string): number {
  const parse = (tag: string) =>
    tag
      .slice(1)
      .split(".")
      .map((n) => parseInt(n, 10));
  const left = parse(a);
  const right = parse(b);
  for (let i = 0; i < 4; i++) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

export function pickRelease(data: unknown): LatestRelease | "none" {
  if (typeof data !== "object" || data === null) return "none";
  const body = data as { tag_name?: unknown; published_at?: unknown; html_url?: unknown };
  const tag = typeof body.tag_name === "string" ? body.tag_name : "";
  if (!CALVER_TAG.test(tag)) return "none";
  return {
    tag,
    publishedAt: typeof body.published_at === "string" ? body.published_at : null,
    url: typeof body.html_url === "string" ? body.html_url : null,
  };
}

export function parseCompare(data: unknown): { aheadBy: number; behindBy: number } | null {
  if (typeof data !== "object" || data === null) return null;
  const body = data as { ahead_by?: unknown; behind_by?: unknown };
  const validCount = (value: unknown): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0;
  if (!validCount(body.ahead_by) || !validCount(body.behind_by)) return null;
  return { aheadBy: body.ahead_by, behindBy: body.behind_by };
}

export function pickCompareBase(tagAtHead: string | null, latestTag: string | null, sha: string): string {
  if (!tagAtHead) return sha;
  if (latestTag && compareCalver(latestTag, tagAtHead) > 0) return latestTag;
  return tagAtHead;
}

export function computeCommitStatus(
  current: { release: string | null; sha: string },
  reachable: string | null,
  latest: { tag: string; url: string | null } | null,
  compare: CompareResult,
): UpdateStatusWire {
  let releaseStanding: UpdateStatusWire["releaseStanding"] = "unknown";
  if (latest) {
    const anchor = current.release ?? reachable;
    if (current.release && compareCalver(current.release, latest.tag) === 0) {
      releaseStanding = "current";
    } else if (anchor) {
      releaseStanding = compareCalver(latest.tag, anchor) > 0 ? "behind" : "ahead";
    }
  }

  const quiet = compare === "unknown" || compare.behindBy > 0;
  const mainAhead = quiet ? 0 : compare.aheadBy;

  return {
    mode: "commit",
    updateAvailable: !quiet && (mainAhead > 0 || (latest !== null && releaseStanding === "behind")),
    current,
    latest,
    releaseStanding,
    mainAhead,
  };
}

export function statusChanged(prev: UpdateStatusWire, next: UpdateStatusWire): boolean {
  return JSON.stringify(prev) !== JSON.stringify(next);
}

async function fetchLatestRelease(): Promise<LatestRelease | "none" | null> {
  try {
    const res = await fetch(latestReleaseUrl(), {
      headers: { Accept: "application/vnd.github.v3+json" },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404) return "none";
    if (!res.ok) return null;
    return pickRelease(await res.json());
  } catch {
    return null;
  }
}

async function fetchCompare(base: string): Promise<CompareResult | null> {
  try {
    const res = await fetch(compareUrl(REPO, base), {
      headers: { Accept: "application/vnd.github.v3+json" },
      signal: AbortSignal.timeout(10000),
    });
    if (res.status === 404) return "unknown";
    if (!res.ok) return null;
    return parseCompare(await res.json());
  } catch {
    return null;
  }
}

function publish(next: UpdateStatusWire): void {
  const changed = statusChanged(status, next);
  status = next;
  if (changed && onChange) onChange(status);
}

async function check() {
  const current = getVersionInfo();
  if (!current.commit || current.commit === "unknown") return;
  const fetched = await fetchLatestRelease();
  if (fetched === null) return;
  const latest = fetched === "none" ? null : { tag: fetched.tag, url: fetched.url };
  const compare = await fetchCompare(pickCompareBase(current.release, latest?.tag ?? null, current.commit));
  if (compare === null) return;
  publish(computeCommitStatus({ release: current.release, sha: current.commit }, getReachableRelease(), latest, compare));
}

export function getUpdateStatus(): UpdateStatusWire {
  return status;
}

export function onUpdateChange(cb: (s: UpdateStatusWire) => void) {
  onChange = cb;
}

export function startUpdateChecker() {
  setTimeout(() => check(), 5000);
  setInterval(() => check(), CHECK_INTERVAL);
}
