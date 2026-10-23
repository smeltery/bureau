import { expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertTestStateIsolated } from "../test-state-guard.ts";

test("test runs refuse the default state root, descendants and symbolic aliases", () => {
  const home = mkdtempSync(join(tmpdir(), "bureau-guard-paths-"));
  try {
    const live = join(home, ".bureau");
    mkdirSync(live);
    symlinkSync(live, join(home, "alias"));
    for (const path of [live, join(live, "new-child"), join(home, "unused", "..", ".bureau"), join(home, "alias"), join(home, "alias", "new-child")]) {
      expect(() => assertTestStateIsolated(path, live, { NODE_ENV: "test" }, undefined)).toThrow("Refusing to run tests");
    }
    expect(() => assertTestStateIsolated(join(home, ".bureau-tests"), live, { NODE_ENV: "test" }, undefined)).not.toThrow();
    expect(() => assertTestStateIsolated(live, live, { NODE_ENV: "production" }, "/tmp/check.spec.ts")).toThrow("Refusing to run tests");
    expect(() => assertTestStateIsolated(live, live, { NODE_ENV: "production" }, "/app/server/index.ts")).not.toThrow();
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("tests outside the repository stop before creating or writing default state", () => {
  const home = mkdtempSync(join(tmpdir(), "bureau-guard-run-"));
  try {
    const file = join(home, "isolated.test.ts");
    const pathsModule = new URL("../paths.ts", import.meta.url).href;
    writeFileSync(file, `import { AGENTS_FILE, atomicWriteFileSync } from ${JSON.stringify(pathsModule)};\natomicWriteFileSync(AGENTS_FILE, "fixture");\n`);
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, NODE_ENV: "production" };
    delete env.BUREAU_HOME;
    const result = Bun.spawnSync([process.execPath, "test", file], { cwd: home, env, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("Refusing to run tests");
    expect(existsSync(join(home, ".bureau"))).toBe(false);

    const disposable = join(home, "test-state");
    const safe = Bun.spawnSync([process.execPath, "test", file], { cwd: home, env: { ...env, BUREAU_HOME: disposable }, stdout: "pipe", stderr: "pipe" });
    expect(safe.exitCode, safe.stderr.toString()).toBe(0);
    expect(readFileSync(join(disposable, "agents.json"), "utf8")).toBe("fixture");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("a test subprocess that loses its state override cannot touch default state", () => {
  const home = mkdtempSync(join(tmpdir(), "bureau-guard-child-"));
  try {
    const pathsModule = new URL("../paths.ts", import.meta.url).href;
    const env: NodeJS.ProcessEnv = { ...process.env, HOME: home, NODE_ENV: "test" };
    delete env.BUREAU_HOME;
    const result = Bun.spawnSync([process.execPath, "--eval", `await import(${JSON.stringify(pathsModule)});`], { cwd: home, env, stdout: "pipe", stderr: "pipe" });
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain("Refusing to run tests");
    expect(existsSync(join(home, ".bureau"))).toBe(false);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
