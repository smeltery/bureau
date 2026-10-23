import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { BUREAU_DIR } from "../persistence/paths.ts";
import type { RecordingHeader, RecordingEvent, RecordingView } from "../../shared/terminal/recordings.ts";

export const MAX_RECORDING_BYTES = 20 * 1024 * 1024;
export const recordingDirectory = (root = BUREAU_DIR) => join(root, "terminal-recordings");
export function safeDirectory(root = BUREAU_DIR, create = false): string {
  const dir = recordingDirectory(root);
  if (create) mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = lstatSync(dir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("Invalid recording directory");
  return dir;
}
export function recordingPath(id: string, root = BUREAU_DIR): string {
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(id)) throw new Error("Invalid recording ID");
  return join(safeDirectory(root), `${id}.jsonl`);
}
export function readRecording(id: string, active: boolean, root = BUREAU_DIR): RecordingView {
  const fd = openSync(recordingPath(id, root), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_RECORDING_BYTES) throw new Error("Invalid recording file");
    const lines = readFileSync(fd, "utf8").split("\n");
    // A crash can leave a partial final write; only complete records are usable.
    lines.pop();
    const header = JSON.parse(lines.shift() ?? "null") as RecordingHeader;
    if (!header || header.version !== 1 || header.id !== id) throw new Error("Invalid recording header");
    const events = lines.filter(Boolean).map((line) => JSON.parse(line) as RecordingEvent);
    return { header, events, active };
  } finally {
    closeSync(fd);
  }
}
export function listRecordingIds(root = BUREAU_DIR): string[] {
  try {
    return readdirSync(safeDirectory(root))
      .filter((name) => /^[a-f0-9-]{36}\.jsonl$/.test(name))
      .map((name) => name.slice(0, -6));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw error;
  }
}
export function deleteRecording(id: string, root = BUREAU_DIR) {
  const path = recordingPath(id, root);
  if (!lstatSync(path).isFile()) throw new Error("Invalid recording file");
  unlinkSync(path);
}

export function readRecordingHeader(id: string, root = BUREAU_DIR): RecordingHeader {
  const fd = openSync(recordingPath(id, root), constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    if (!fstatSync(fd).isFile()) throw new Error("Invalid recording file");
    const buffer = Buffer.alloc(8192);
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    const newline = buffer.indexOf(10, 0);
    if (newline < 0 || newline >= length) throw new Error("Invalid recording header");
    const header = JSON.parse(buffer.subarray(0, newline).toString()) as RecordingHeader;
    if (header.version !== 1 || header.id !== id) throw new Error("Invalid recording header");
    return header;
  } finally {
    closeSync(fd);
  }
}
