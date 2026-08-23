import { describe, expect, test } from "bun:test";
import { compareCalver, computeCommitStatus, latestCommitUrl, latestReleaseUrl, parseCompare, pickCompareBase, pickRelease, statusChanged } from "./update-checker.ts";

describe("update checker", () => {
  test("checks Bureau's default branch for the latest commit", () => {
    expect(latestCommitUrl()).toBe("https://api.github.com/repos/smeltery/bureau/commits/master");
  });

  test("builds commit URLs for explicit repositories and branches", () => {
    expect(latestCommitUrl("owner/repo", "release")).toBe("https://api.github.com/repos/owner/repo/commits/release");
  });

  test("checks Bureau's latest release endpoint", () => {
    expect(latestReleaseUrl()).toBe("https://api.github.com/repos/smeltery/bureau/releases/latest");
  });
});

describe("release-aware update decisions", () => {
  const sha = "abc1234abc1234abc1234abc1234abc1234abc12";
  const rel = (tag: string) => ({ tag, url: null });
  const cmp = (aheadBy: number, behindBy = 0) => ({ aheadBy, behindBy });

  test("orders CalVer tags numerically", () => {
    expect(compareCalver("v2026.10.1", "v2026.9.30")).toBeGreaterThan(0);
    expect(compareCalver("v2026.7.19.2", "v2026.7.19")).toBeGreaterThan(0);
  });

  test("maps latest release responses and ignores non-CalVer channels", () => {
    expect(pickRelease({ tag_name: "v2026.7.24", published_at: "2026-07-24T00:00:00Z", html_url: "https://github.com/smeltery/bureau/releases/tag/v2026.7.24" })).toEqual({
      tag: "v2026.7.24",
      publishedAt: "2026-07-24T00:00:00Z",
      url: "https://github.com/smeltery/bureau/releases/tag/v2026.7.24",
    });
    expect(pickRelease({ tag_name: "v1.0" })).toBe("none");
  });

  test("keeps local-ahead and diverged checkouts quiet", () => {
    expect(computeCommitStatus({ release: null, sha }, "v2026.7.20", rel("v2026.7.24"), "unknown").updateAvailable).toBe(false);
    expect(computeCommitStatus({ release: null, sha }, "v2026.7.20", rel("v2026.7.24"), cmp(2, 1)).updateAvailable).toBe(false);
  });

  test("offers newer releases and reports main drift", () => {
    const status = computeCommitStatus({ release: "v2026.7.20", sha }, "v2026.7.20", rel("v2026.7.24"), cmp(3));
    expect(status.updateAvailable).toBe(true);
    expect(status.releaseStanding).toBe("behind");
    expect(status.mainAhead).toBe(3);
  });

  test("compares stale tags from the latest release instead of the stale checkout tag", () => {
    expect(pickCompareBase("v2026.7.20", "v2026.7.24", sha)).toBe("v2026.7.24");
    expect(pickCompareBase(null, "v2026.7.24", sha)).toBe(sha);
  });

  test("malformed compare responses are transient, not no-drift", () => {
    expect(parseCompare({ ahead_by: 1, behind_by: 0 })).toEqual({ aheadBy: 1, behindBy: 0 });
    expect(parseCompare({ ahead_by: "1", behind_by: 0 })).toBeNull();
  });

  test("rebroadcasts any material payload change", () => {
    const first = computeCommitStatus({ release: "v2026.7.20", sha }, "v2026.7.20", rel("v2026.7.24"), cmp(0));
    const second = computeCommitStatus({ release: "v2026.7.20", sha }, "v2026.7.20", rel("v2026.7.25"), cmp(0));
    expect(statusChanged(first, second)).toBe(true);
    expect(statusChanged(first, first)).toBe(false);
  });
});
