import { describe, expect, test } from "bun:test";
import { join } from "path";
import { tildifyCwd } from "../../agents/session/paths.ts";

// tildifyCwd is the display-only inverse of resolveCwd's home expansion, used by
// the /resume picker to show each session's cwd compactly. Pure function (no fs
// / no module-load state), so it's safe to import directly in the shared bun
// test registry. The fs-backed per-session-cwd helpers (persistSessionCwd /
// getSessionCwd / ensureSessionCwd) read LOGS_DIR — a module-load constant — so
// they can't be isolated to a temp BUREAU_HOME without risking the real one;
// they're exercised end-to-end by the running server instead.
describe("tildifyCwd", () => {
  const home = process.env.HOME || "";

  test("abbreviates the exact home dir to ~", () => {
    if (!home) return;
    expect(tildifyCwd(home)).toBe("~");
  });

  test("abbreviates a home-rooted path", () => {
    if (!home) return;
    expect(tildifyCwd(join(home, "projects/bureau"))).toBe("~/projects/bureau");
  });

  test("leaves unrelated paths untouched", () => {
    expect(tildifyCwd("/var/log/system")).toBe("/var/log/system");
  });

  test("does not abbreviate a path that merely shares the home prefix string", () => {
    if (!home) return;
    // e.g. /home/meta must not match /home/me — the match needs a trailing slash.
    expect(tildifyCwd(home + "-sibling")).toBe(home + "-sibling");
  });
});
