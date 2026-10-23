import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { prepareBackupDestination, readBackupSettings, saveBackupSettings } from "./settings.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "bureau-backup-settings-"));
  roots.push(root);
  const state = join(root, ".bureau");
  mkdirSync(state);
  return { root, state, file: join(state, "backup-settings.json") };
}

test("settings persist partial updates and keep old directories intact", () => {
  const { root, state } = fixture();
  const initial = readBackupSettings(state, "");
  expect(initial.settings).toEqual({ intervalHours: 24, retention: 7, dir: null });
  expect(initial.effectiveDir).toBe(join(root, "bureau-backups"));
  const custom = join(root, "custom");
  const saved = saveBackupSettings({ intervalHours: 2, retention: 3, dir: custom }, state, "");
  expect(saved.previousDir).toBe(initial.effectiveDir);
  writeFileSync(join(custom, "keep.txt"), "keep");
  expect(saveBackupSettings({ retention: 1 }, state, "").settings.intervalHours).toBe(2);
  const reset = saveBackupSettings({ dir: null }, state, "");
  expect(reset.effectiveDir).toBe(initial.effectiveDir);
  expect(reset.previousDir).toBe(custom);
  expect(readFileSync(join(custom, "keep.txt"), "utf8")).toBe("keep");
  expect(readBackupSettings(state, "").settings.retention).toBe(1);
});

test("environment destination takes precedence without replacing the stored preference", () => {
  const { root, state } = fixture();
  const custom = join(root, "custom"),
    environment = join(root, "environment");
  saveBackupSettings({ dir: custom }, state, "");
  expect(readBackupSettings(state, environment).effectiveDir).toBe(environment);
  expect(() => saveBackupSettings({ dir: null }, state, environment)).toThrow("BUREAU_BACKUP_DIR");
  const saved = saveBackupSettings({ intervalHours: 48 }, state, environment);
  expect(saved.directoryFromEnvironment).toBe(true);
  expect(saved.settings.dir).toBe(custom);
  expect(readBackupSettings(state, "").effectiveDir).toBe(custom);
});

test("invalid updates and unreadable settings never replace persisted bytes", () => {
  const { state, file } = fixture();
  saveBackupSettings({}, state, "");
  const before = readFileSync(file, "utf8");
  for (const input of [
    null,
    [],
    { intervalHours: 0 },
    { intervalHours: 721 },
    { intervalHours: 1.5 },
    { retention: 0 },
    { retention: 101 },
    { retention: "7" },
    { dir: "relative" },
    { extra: true },
  ]) {
    expect(() => saveBackupSettings(input, state, "")).toThrow();
    expect(readFileSync(file, "utf8")).toBe(before);
  }
  writeFileSync(file, "{broken");
  expect(() => saveBackupSettings({ retention: 2 }, state, "")).toThrow();
  expect(readFileSync(file, "utf8")).toBe("{broken");
  rmSync(file);
  mkdirSync(file);
  expect(() => saveBackupSettings({}, state, "")).toThrow();
});

test("destinations inside state are rejected before creating directories, including symlink ancestors", () => {
  const { root, state } = fixture();
  const alias = join(root, "alias");
  symlinkSync(state, alias, "dir");
  for (const directory of [state, join(state, "new"), alias, join(alias, "new", "nested")]) {
    expect(() => prepareBackupDestination(directory, state)).toThrow("outside");
  }
  expect(existsSync(join(state, "new"))).toBe(false);
  expect(() => saveBackupSettings({}, state, join(alias, "new"))).toThrow("outside");
  const outside = join(root, "outside");
  prepareBackupDestination(outside, alias);
  expect(existsSync(outside)).toBe(true);
  writeFileSync(join(root, "file"), "data");
  expect(() => prepareBackupDestination(join(root, "file"), state)).toThrow();
  expect(() => prepareBackupDestination("relative", state)).toThrow("absolute");
});
