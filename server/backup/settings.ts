import { accessSync, constants, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import type { BackupSettings, BackupSettingsSaved, BackupSettingsView } from "../../shared/storage-types.ts";
import { atomicWriteFileSync, BUREAU_DIR } from "../persistence/paths.ts";

export const DEFAULT_BACKUP_SETTINGS: BackupSettings = { intervalHours: 24, retention: 7, dir: null };
export class BackupSettingsError extends Error {}

export function defaultBackupDirectory(stateRoot: string): string {
  return join(dirname(stateRoot), `${basename(stateRoot).replace(/^\./, "")}-backups`);
}

function settingsFile(root: string): string {
  return join(root, "backup-settings.json");
}

function parsedSettings(value: unknown, previous = DEFAULT_BACKUP_SETTINGS): BackupSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BackupSettingsError("backup settings must be an object");
  const input = value as Record<string, unknown>;
  for (const key of Object.keys(input)) if (!["intervalHours", "retention", "dir"].includes(key)) throw new BackupSettingsError(`unknown backup setting: ${key}`);
  const next = { ...previous, ...input } as BackupSettings;
  if (!Number.isInteger(next.intervalHours) || next.intervalHours < 1 || next.intervalHours > 720) throw new BackupSettingsError("intervalHours must be an integer from 1 to 720");
  if (!Number.isInteger(next.retention) || next.retention < 1 || next.retention > 100) throw new BackupSettingsError("retention must be an integer from 1 to 100");
  if (next.dir !== null && (typeof next.dir !== "string" || !isAbsolute(next.dir))) throw new BackupSettingsError("backup directory must be an absolute path, or null for the default");
  return next;
}

export function readBackupSettings(stateRoot = BUREAU_DIR, envDir = process.env.BUREAU_BACKUP_DIR): BackupSettingsView {
  let settings = { ...DEFAULT_BACKUP_SETTINGS };
  try {
    settings = parsedSettings(JSON.parse(readFileSync(settingsFile(stateRoot), "utf8")));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return { settings, effectiveDir: envDir || settings.dir || defaultBackupDirectory(stateRoot), directoryFromEnvironment: !!envDir };
}

function prospectivePath(path: string): string {
  try {
    return realpathSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    const parent = dirname(path);
    if (parent === path) throw error;
    return resolve(prospectivePath(parent), basename(path));
  }
}

function inside(root: string, path: string): boolean {
  const child = relative(root, path);
  return child === "" || (!child.startsWith(`..${process.platform === "win32" ? "\\" : "/"}`) && child !== ".." && !isAbsolute(child));
}

/** Validate before creating anything; resolve existing symlink ancestors too. */
export function prepareBackupDestination(directory: string, stateRoot: string): void {
  if (!isAbsolute(directory)) throw new BackupSettingsError("backup directory must be an absolute path");
  const root = prospectivePath(resolve(stateRoot));
  const check = (path: string) => {
    if (inside(root, path) || inside(resolve(stateRoot), path)) throw new BackupSettingsError("backup directory must be outside the office state directory");
  };
  check(resolve(directory));
  check(prospectivePath(resolve(directory)));
  mkdirSync(directory, { recursive: true });
  check(realpathSync(directory));
  accessSync(directory, constants.W_OK);
}

export function saveBackupSettings(input: unknown, stateRoot = BUREAU_DIR, envDir = process.env.BUREAU_BACKUP_DIR): BackupSettingsSaved {
  const before = readBackupSettings(stateRoot, envDir);
  const settings = parsedSettings(input, before.settings);
  if (envDir && settings.dir !== before.settings.dir) throw new BackupSettingsError("BUREAU_BACKUP_DIR controls the backup directory; change the environment to override it");
  const effectiveDir = envDir || settings.dir || defaultBackupDirectory(stateRoot);
  prepareBackupDestination(effectiveDir, stateRoot);
  atomicWriteFileSync(settingsFile(stateRoot), JSON.stringify(settings, null, 2));
  return { settings, effectiveDir, directoryFromEnvironment: !!envDir, previousDir: before.effectiveDir !== effectiveDir ? before.effectiveDir : null };
}
