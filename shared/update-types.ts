export interface LatestRelease {
  tag: string;
  publishedAt: string | null;
  url: string | null;
}

export type ReleaseStanding = "current" | "behind" | "ahead" | "unknown";

export interface CommitUpdateStatus {
  mode: "commit";
  updateAvailable: boolean;
  current: { release: string | null; sha: string };
  latest: { tag: string; url: string | null } | null;
  releaseStanding: ReleaseStanding;
  mainAhead: number;
}

export type UpdateApply = { kind: "host" } | { kind: "image"; guide: "kubernetes" | "render" | "container" };

export interface ReleaseUpdateStatus {
  mode: "release";
  updateAvailable: boolean;
  current: { release: string | null; version: string | null };
  latest: LatestRelease | null;
  apply: UpdateApply;
}

export type UpdateStatusWire = CommitUpdateStatus | ReleaseUpdateStatus;
