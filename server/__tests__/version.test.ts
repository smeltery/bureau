import { describe, expect, test } from "bun:test";
import { resolveReachableRelease, resolveVersion, resolveVersionInfo, type GitRunner } from "../version.ts";

function fakeGit(outputs: Record<string, string | Error>): GitRunner {
  return (args) => {
    const key = args.join(" ");
    const output = outputs[key];
    if (output instanceof Error) throw output;
    if (output === undefined) throw new Error(`unexpected git call: ${key}`);
    return output;
  };
}

describe("resolveVersionInfo", () => {
  test("returns version, commit, and exact release tag", () => {
    const info = resolveVersionInfo(
      fakeGit({
        "describe --tags --always --dirty --match v*": "v2026.7.22\n",
        "rev-parse HEAD": "abc123\n",
        "tag --points-at HEAD": "v2026.7.22\n",
      }),
    );

    expect(info).toEqual({
      version: "v2026.7.22",
      commit: "abc123",
      release: "v2026.7.22",
    });
  });

  test("omits release for non-release exact tags", () => {
    const info = resolveVersionInfo(
      fakeGit({
        "describe --tags --always --dirty --match v*": "v1.0.0\n",
        "rev-parse HEAD": "abc123\n",
        "tag --points-at HEAD": "v1.0.0\n",
      }),
    );

    expect(info.release).toBeNull();
  });

  test("returns null identity when git metadata is unavailable", () => {
    const missing = new Error("git unavailable");
    const info = resolveVersionInfo(
      fakeGit({
        "describe --tags --always --dirty --match v*": missing,
        "rev-parse HEAD": missing,
        "tag --points-at HEAD": missing,
      }),
    );

    expect(info).toEqual({
      version: null,
      commit: null,
      release: null,
    });
  });

  test("uses Render commit metadata when git metadata is unavailable", () => {
    const missing = new Error("git unavailable");
    const commit = "abc1234abc1234abc1234abc1234abc1234abc12";
    const version = resolveVersion(
      fakeGit({
        "describe --tags --always --dirty --match v*": missing,
        "rev-parse HEAD": missing,
        "tag --points-at HEAD": missing,
      }),
      { RENDER: "true", RENDER_GIT_COMMIT: commit },
    );

    expect(version).toEqual({
      info: {
        version: commit,
        commit,
        release: null,
      },
      source: "image",
    });
  });

  test("chooses the highest CalVer tag when multiple tags point at HEAD", () => {
    const info = resolveVersionInfo(
      fakeGit({
        "describe --tags --always --dirty --match v*": "v2026.7.23\n",
        "rev-parse HEAD": "abc123\n",
        "tag --points-at HEAD": "v1.0.0\nv2026.7.22\nv2026.7.23\n",
      }),
    );

    expect(info.release).toBe("v2026.7.23");
  });
});

describe("resolveReachableRelease", () => {
  test("returns the newest reachable CalVer release", () => {
    expect(
      resolveReachableRelease(
        fakeGit({
          "tag --merged HEAD --list v*": "v1.0.0\nv2026.7.20\nv2026.7.22\n",
        }),
      ),
    ).toBe("v2026.7.22");
  });
});
