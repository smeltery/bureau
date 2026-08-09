// Point the test suite at a throwaway state directory, before anything reads
// the real one.
//
// `BUREAU_DIR` (server/persistence/paths.ts) is resolved ONCE at module load
// from `process.env.BUREAU_HOME`, defaulting to `~/.bureau`. Any test that
// reaches a persistence path therefore writes the operator's real office: a
// single test file was measured rewriting `~/.bureau/agents.json`. Anyone
// running `bun test` on a machine with a live office overwrote that office's
// agents.json, agents-summary.json and history with test fixtures.
//
// A preload is the only place that can be fixed once: `bunfig.toml`'s
// `[test].preload` runs before the first test module is imported, so the
// constant is computed from the temp path. Fixing it inside test files cannot
// work — by the time a test body runs, the module holding `BUREAU_DIR` has
// already been evaluated.
//
// WHAT THIS DOES NOT FIX, so nobody deletes the guards that do. Bun runs the
// suite in one process, so this is ONE directory shared by every test file — the
// state is disposable, not per-file. A file that calls `persistAll()` still
// writes a map a later file can read back when its import graph boots the server
// (server/index.ts → restoreAgents), which restores another file's fixtures into
// the shared agents map: individually passing files, a failing suite, and a
// failure that moves with file order. The files that clear-and-re-persist in
// `afterEach` are still load-bearing for that.
//
// An explicitly-set BUREAU_HOME is respected, so a targeted run can still be
// pointed somewhere deliberate (and so the isolated-instance patterns keep
// working). The directory is removed on exit; a leftover on a hard kill is a
// few KB in the OS temp dir.

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (!process.env.BUREAU_HOME?.trim()) {
  const dir = mkdtempSync(join(tmpdir(), "bureau-test-home-"));
  process.env.BUREAU_HOME = dir;
  process.on("exit", () => {
    // Guarded on the prefix we created: this runs in the same process as the
    // tests, and a recursive delete of anything else would be unforgivable.
    if (dir.startsWith(tmpdir())) rmSync(dir, { recursive: true, force: true });
  });
}
