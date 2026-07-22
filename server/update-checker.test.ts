import { describe, expect, test } from "bun:test";
import { latestCommitUrl } from "./update-checker.ts";

describe("update checker", () => {
  test("checks Bureau's default branch for the latest commit", () => {
    expect(latestCommitUrl()).toBe("https://api.github.com/repos/dotbrains/bureau/commits/master");
  });

  test("builds commit URLs for explicit repositories and branches", () => {
    expect(latestCommitUrl("owner/repo", "release")).toBe("https://api.github.com/repos/owner/repo/commits/release");
  });
});
