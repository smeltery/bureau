// Scheduled backup of office state to a verified local tarball.
//
// A backup is published in three steps: write a uniquely named partial file,
// walk the whole archive with `tar -tzf`, then rename it and write a verification
// marker. The marker records the final file's size and mtime. A final file with
// no matching marker is not a backup: the process may have stopped between the
// rename and the marker write, or an older release may have written it directly.
// The next tick verifies such legacy/orphaned files before it trusts them.
//
// Retention runs only after publication and considers only verified finals. A
// failed run therefore cannot displace a good backup. Restore is documented in
// docs/contributing/backup-restore.md.

import { basename, dirname, join } from "path";
import { renameSync, statfsSync, unlinkSync } from "fs";
import { errMessage } from "../shared/errors.ts";
import { BUREAU_DIR } from "./persistence/paths.ts";
import {
  allocateFinalPath,
  certifyUnmarkedArchives,
  finalBackupName,
  isBackupPartial,
  newestVerifiedBackup,
  partialPath,
  prepareBackupDirectory,
  pruneVerified,
  requiredFreeBytes,
  runTar,
  statusFromDisk,
  verifyArchive,
  writeMarker,
  type BackupConfig,
  type BackupDeps,
  type BackupStatus,
  type TarFlavor,
} from "./backup/files.ts";
import { removeBackupStaging, stageBackupRoot } from "./backup/exclusions.ts";

import { readBackupSettings, prepareBackupDestination } from "./backup/settings.ts";

export type { BackupStatus } from "./backup/files.ts";

const BUREAU_DIR_PARENT = dirname(BUREAU_DIR);
const BUREAU_DIR_NAME = basename(BUREAU_DIR);
const CHECK_INTERVAL_MS = 60 * 60 * 1000;
const FIRST_BACKUP_MIN_FREE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GiB
const MIN_HEADROOM_BYTES = 256 * 1024 * 1024; // 256 MiB

let lastAttemptAt: number | null = null;
let lastAttemptError: string | null = null;
let running = false;
const preparedDirectories = new Set<string>();
let lastAttemptDirectory: string | null = null;

export function currentBackupConfig(): BackupConfig {
  const { settings, effectiveDir } = readBackupSettings();
  return {
    backupDir: effectiveDir,
    stateRootParent: BUREAU_DIR_PARENT,
    stateRootName: BUREAU_DIR_NAME,
    retention: settings.retention,
    intervalHours: settings.intervalHours,
    firstBackupMinFreeBytes: FIRST_BACKUP_MIN_FREE_BYTES,
    minHeadroomBytes: MIN_HEADROOM_BYTES,
  };
}

const DEFAULT_DEPS: BackupDeps = {
  now: () => Date.now(),
  spawn: (argv) => Bun.spawn(argv, { stdout: "pipe", stderr: "pipe" }),
  availableBytes: (dir) => {
    const fs = statfsSync(dir);
    // Bun 1.3.11 on Intel macOS can return statfs with bsize 0. df gives the
    // same number portably and keeps the backup scheduler honest.
    if (Number(fs.bsize) > 0) return Number(fs.bavail) * Number(fs.bsize);
    return dfAvailableBytes(dir);
  },
};

export function dfAvailableBytes(dir: string): number {
  const df = Bun.spawnSync(["df", "-Pk", dir], { stderr: "pipe" });
  const kib = Number(df.stdout.toString().trim().split("\n").at(-1)?.split(/\s+/)[3]);
  if (df.exitCode !== 0 || !Number.isFinite(kib)) {
    throw new Error(`could not read free space: df exit ${df.exitCode}: ${df.stderr.toString().trim()}`);
  }
  return kib * 1024;
}

async function detectTarFlavor(): Promise<TarFlavor> {
  const tar = Bun.spawn(["tar", "--version"], { stdout: "pipe", stderr: "ignore" });
  const [version] = await Promise.all([new Response(tar.stdout).text(), tar.exited]);
  if (/bsdtar|libarchive/.test(version)) return "bsd";
  if (/GNU tar/.test(version)) return "gnu";
  throw new Error(`unsupported tar: ${version.split("\n")[0] || "no version output"}`);
}

export function getBackupStatus(): BackupStatus {
  const config = currentBackupConfig();
  const sameDirectory = config.backupDir === lastAttemptDirectory;
  return statusFromDisk(config, Date.now(), sameDirectory ? lastAttemptAt : null, sameDirectory ? lastAttemptError : null, running);
}

export async function runBackupOnceForTest(overrides: Partial<BackupConfig>, deps: BackupDeps): Promise<string> {
  return runBackup({ ...currentBackupConfig(), ...overrides }, deps);
}

export function backupStatusForTest(overrides: Partial<BackupConfig>, now: number): BackupStatus {
  return statusFromDisk({ ...currentBackupConfig(), ...overrides }, now, null, null, false);
}

export function prepareBackupDirectoryForTest(dir: string): void {
  prepareBackupDirectory(dir);
}

async function runBackup(config: BackupConfig = currentBackupConfig(), deps: BackupDeps = DEFAULT_DEPS): Promise<string> {
  prepareBackupDestination(config.backupDir, join(config.stateRootParent, config.stateRootName));
  await certifyUnmarkedArchives(config, deps);
  const newest = newestVerifiedBackup(config.backupDir);
  const required = requiredFreeBytes(newest, config);
  const available = deps.availableBytes(config.backupDir);
  if (available < required) {
    throw new Error(`not enough free space: ${available} bytes available, ${Math.ceil(required)} required; existing verified backups were kept`);
  }

  const now = deps.now();
  const partial = partialPath(config.backupDir, now);
  const final = allocateFinalPath(config.backupDir, now);
  const flavor = await (deps.tarFlavor ?? detectTarFlavor)();
  let backupStaging: string | null = null;
  try {
    backupStaging = stageBackupRoot(config);
    const created = await runTar(["tar", "-czf", partial, "-C", backupStaging, config.stateRootName], deps);
    // GNU tar exits 1 when a file changed while read. bsdtar uses 1 for every
    // error, so any non-zero bsdtar exit is a failure.
    if (created.exitCode >= 2 || (flavor === "bsd" && created.exitCode !== 0)) {
      throw new Error(`tar exit ${created.exitCode}: ${created.stderr || "no error text"}`);
    }
    if (created.exitCode === 1) {
      console.warn("[backup] tar exit 1 (file changed during archive; verifying before publication)");
    }
    await verifyArchive(partial, config.stateRootName, deps);
    renameSync(partial, final);
    writeMarker(final);
    pruneVerified(config);
    return finalBackupName(final);
  } finally {
    try {
      unlinkSync(partial);
    } catch {}
    if (backupStaging) removeBackupStaging(backupStaging);
  }
}

async function tick() {
  if (running) return;
  running = true;
  try {
    const config = currentBackupConfig();
    lastAttemptDirectory = config.backupDir;
    prepareBackupDestination(config.backupDir, BUREAU_DIR);
    if (!preparedDirectories.has(config.backupDir)) {
      lastAttemptAt = Date.now();
      prepareBackupDirectory(config.backupDir);
      preparedDirectories.add(config.backupDir);
      lastAttemptError = null;
    }
    // Certify legacy archives before deciding whether another run is due.
    await certifyUnmarkedArchives(config, DEFAULT_DEPS);
    const newest = newestVerifiedBackup(config.backupDir);
    if (newest && Date.now() - newest.mtimeMs < (config.intervalHours ?? 24) * 3_600_000) return;
    lastAttemptAt = Date.now();
    const file = await runBackup(config);
    lastAttemptError = null;
    console.log(`[backup] wrote and verified ${file}`);
  } catch (err) {
    lastAttemptAt = Date.now();
    lastAttemptError = errMessage(err);
    console.error("[backup] failed; existing verified backups were kept:", err);
  } finally {
    running = false;
  }
}

export function startBackupScheduler() {
  // A low-space refusal happens before tar reads the state root. Retrying it
  // hourly is therefore a cheap statfs check, not an hourly full archive.
  void tick();
  setInterval(() => void tick(), CHECK_INTERVAL_MS);
}

/** Test-only visibility for names that must never be counted as backups. */
export function isBackupPartialForTest(file: string): boolean {
  return isBackupPartial(file);
}
