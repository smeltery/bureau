import { describe, expect, test } from "bun:test";
import { resolveVersionInfo, type GitRunner } from "../version.ts";

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
        "describe --tags --exact-match --match v*": "v2026.7.22\n",
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
        "describe --tags --exact-match --match v*": "v1.0.0\n",
      }),
    );

    expect(info.release).toBeNull();
  });

  test("falls back to unknown when git metadata is unavailable", () => {
    const missing = new Error("git unavailable");
    const info = resolveVersionInfo(
      fakeGit({
        "describe --tags --always --dirty --match v*": missing,
        "rev-parse HEAD": missing,
        "describe --tags --exact-match --match v*": missing,
      }),
    );

    expect(info).toEqual({
      version: "unknown",
      commit: "unknown",
      release: null,
    });
  });
});
