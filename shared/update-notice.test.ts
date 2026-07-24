import { describe, expect, test } from "bun:test";
import { computeCommitStatus } from "../server/update-checker.ts";
import { buildCommitNotice } from "./update-notice.ts";

const sha = "abc1234abc1234abc1234abc1234abc1234abc12";
const rel = (tag: string) => ({ tag, url: null });
const cmp = (aheadBy: number, behindBy = 0) => ({ aheadBy, behindBy });

describe("buildCommitNotice", () => {
  test("returns null for quiet states", () => {
    const status = computeCommitStatus({ release: "v2026.7.24", sha }, "v2026.7.24", rel("v2026.7.24"), cmp(0));
    expect(buildCommitNotice(status)).toBeNull();
  });

  test("describes a newer release with extra master commits", () => {
    const status = computeCommitStatus({ release: "v2026.7.20", sha }, "v2026.7.20", rel("v2026.7.24"), cmp(2));
    expect(buildCommitNotice(status)).toEqual({
      pill: "new release",
      title: "New Release Available",
      notice: "You're on v2026.7.20; v2026.7.24 is out. master has 2 commits beyond that.",
    });
  });

  test("describes untagged source checkouts by short commit", () => {
    const status = computeCommitStatus({ release: null, sha }, "v2026.7.24", rel("v2026.7.24"), cmp(1));
    expect(buildCommitNotice(status)).toEqual({
      pill: "master +1",
      title: "Newer Commits on master",
      notice: "You're on commit abc1234, past the latest release (v2026.7.24). master has 1 newer commit if you want the bleeding edge.",
    });
  });
});
