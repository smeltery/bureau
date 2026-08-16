import { basename, join } from "path";
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "fs";
import { errMessage } from "../../shared/errors.ts";

const BACKUP_HEALTH_MAX_AGE_MS = 26 * 60 * 60 * 1000; // 26h
const FILENAME_PATTERN = /^bureau-(\d{4}-\d{2}-\d{2})(?:-(\d+))?\.tar\.gz$/;
const PARTIAL_PATTERN = /^\.bureau-backup-.*\.partial$/;

export interface BackupStatus {
  stateDir: string;
  backupDir: string;
  retention: number;
  lastBackupAt: number | null;
  lastBackupOk: boolean | null;
  lastBackupError: string | null;
  lastBackupFile: string | null;
  running: boolean;
}

export interface BackupConfig {
  backupDir: string;
  stateRootParent: string;
  stateRootName: string;
  retention: number;
  firstBackupMinFreeBytes: number;
  minHeadroomBytes: number;
}

export interface BackupDeps {
  now(): number;
  spawn(argv: string[]): Subprocess;
  availableBytes(dir: string): number;
}

interface Subprocess {
  exited: Promise<number>;
  stderr: ReadableStream<Uint8Array>;
}

interface VerifiedBackup {
  file: string;
  path: string;
  size: number;
  mtimeMs: number;
}

interface VerificationMarker {
  size: number;
  mtimeMs: number;
}

export function statusFromDisk(config: BackupConfig, now: number, attemptAt: number | null, attemptError: string | null, isRunning: boolean): BackupStatus {
  const newest = newestVerifiedBackup(config.backupDir);
  const newestAt = newest?.mtimeMs ?? null;
  const stale = newestAt !== null && now - newestAt >= BACKUP_HEALTH_MAX_AGE_MS;
  const failedAfterNewest = attemptError !== null && attemptAt !== null && (newestAt === null || attemptAt > newestAt);
  return {
    stateDir: join(config.stateRootParent, config.stateRootName),
    backupDir: config.backupDir,
    retention: config.retention,
    lastBackupAt: failedAfterNewest ? attemptAt : newestAt,
    lastBackupOk: newestAt === null ? (failedAfterNewest ? false : null) : !failedAfterNewest && !stale,
    lastBackupError: failedAfterNewest ? attemptError : stale ? "newest verified backup is more than 26 hours old" : null,
    lastBackupFile: newest?.file ?? null,
    running: isRunning,
  };
}

function markerPath(archivePath: string): string {
  return `${archivePath}.verified.json`;
}

function invalidMarkerPath(archivePath: string): string {
  return `${archivePath}.invalid.json`;
}

function readVerifiedBackup(dir: string, file: string): VerifiedBackup | null {
  if (!FILENAME_PATTERN.test(file)) return null;
  const path = join(dir, file);
  try {
    const stat = statSync(path);
    const marker = JSON.parse(readFileSync(markerPath(path), "utf8")) as VerificationMarker;
    if (marker.size !== stat.size || marker.mtimeMs !== stat.mtimeMs) {
      return null;
    }
    return { file, path, size: stat.size, mtimeMs: stat.mtimeMs };
  } catch {
    return null;
  }
}

function listVerifiedBackups(dir: string): VerifiedBackup[] {
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .map((file) => readVerifiedBackup(dir, file))
    .filter((item): item is VerifiedBackup => item !== null)
    .sort((a, b) => a.mtimeMs - b.mtimeMs || a.file.localeCompare(b.file));
}

export function newestVerifiedBackup(dir: string): VerifiedBackup | null {
  return listVerifiedBackups(dir).at(-1) ?? null;
}

function dateStr(now: number): string {
  const d = new Date(now);
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function allocateFinalPath(dir: string, now: number): string {
  const stem = `bureau-${dateStr(now)}`;
  let sequence = 1;
  for (;;) {
    const suffix = sequence === 1 ? "" : `-${sequence}`;
    const path = join(dir, `${stem}${suffix}.tar.gz`);
    if (!existsSync(path) && !existsSync(markerPath(path))) return path;
    sequence++;
  }
}

export function partialPath(dir: string, now: number): string {
  return join(dir, `.bureau-backup-${process.pid}-${now}-${Math.random().toString(36).slice(2)}.partial`);
}

export function prepareBackupDirectory(dir: string): void {
  mkdirSync(dir, { recursive: true });
  // This runs once, before the scheduler can own a partial. A partial can
  // survive only when the previous server process died during tar, so every
  // matching file here is an orphan that the new process must reclaim.
  for (const file of readdirSync(dir)) {
    if (!PARTIAL_PATTERN.test(file)) continue;
    unlinkSync(join(dir, file));
  }
}

export function requiredFreeBytes(newest: VerifiedBackup | null, config: BackupConfig): number {
  if (!newest) return config.firstBackupMinFreeBytes;
  return newest.size + Math.max(config.minHeadroomBytes, newest.size / 4);
}

export async function runTar(
  argv: string[],
  deps: BackupDeps,
): Promise<{
  exitCode: number;
  stderr: string;
}> {
  const proc = deps.spawn(argv);
  const [exitCode, stderr] = await Promise.all([proc.exited, new Response(proc.stderr).text()]);
  return { exitCode, stderr: stderr.trim().slice(0, 500) };
}

export function writeMarker(archivePath: string): void {
  const stat = statSync(archivePath);
  const finalMarker = markerPath(archivePath);
  const tempMarker = `${finalMarker}.${process.pid}.tmp`;
  try {
    const fd = openSync(tempMarker, "wx", 0o600);
    try {
      writeFileSync(fd, `${JSON.stringify({ size: stat.size, mtimeMs: stat.mtimeMs })}\n`);
    } finally {
      closeSync(fd);
    }
    renameSync(tempMarker, finalMarker);
    try {
      unlinkSync(invalidMarkerPath(archivePath));
    } catch {}
  } finally {
    try {
      unlinkSync(tempMarker);
    } catch {}
  }
}

function invalidMarkerMatches(archivePath: string): boolean {
  try {
    const stat = statSync(archivePath);
    const marker = JSON.parse(readFileSync(invalidMarkerPath(archivePath), "utf8")) as VerificationMarker;
    return marker.size === stat.size && marker.mtimeMs === stat.mtimeMs;
  } catch {
    return false;
  }
}

function writeInvalidMarker(archivePath: string): void {
  const stat = statSync(archivePath);
  writeFileSync(invalidMarkerPath(archivePath), `${JSON.stringify({ size: stat.size, mtimeMs: stat.mtimeMs })}\n`, { mode: 0o600 });
}

export async function verifyArchive(path: string, deps: BackupDeps): Promise<void> {
  const checked = await runTar(["tar", "-tzf", path], deps);
  if (checked.exitCode !== 0) {
    throw new Error(`archive verification exit ${checked.exitCode}: ${checked.stderr || "no error text"}`);
  }
}

export async function certifyUnmarkedArchives(config: BackupConfig, deps: BackupDeps): Promise<void> {
  if (!existsSync(config.backupDir)) return;
  const candidates = readdirSync(config.backupDir)
    .filter((file) => FILENAME_PATTERN.test(file))
    .filter((file) => !readVerifiedBackup(config.backupDir, file))
    .map((file) => ({ file, path: join(config.backupDir, file) }))
    .filter((candidate) => !invalidMarkerMatches(candidate.path))
    .sort((a, b) => statSync(b.path).mtimeMs - statSync(a.path).mtimeMs);
  for (const candidate of candidates) {
    try {
      await verifyArchive(candidate.path, deps);
      writeMarker(candidate.path);
    } catch (err) {
      writeInvalidMarker(candidate.path);
      console.error(`[backup] existing archive ${candidate.file} is not verified: ${errMessage(err)}`);
    }
  }
}

export function pruneVerified(config: BackupConfig): void {
  const files = listVerifiedBackups(config.backupDir);
  while (files.length > config.retention) {
    const oldest = files.shift()!;
    unlinkSync(oldest.path);
    unlinkSync(markerPath(oldest.path));
  }
}

export function finalBackupName(path: string): string {
  return basename(path);
}

export function isBackupPartial(file: string): boolean {
  return PARTIAL_PATTERN.test(file);
}
