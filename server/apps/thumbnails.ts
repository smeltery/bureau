import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import type { AppRecord } from "../../shared/apps.ts";
import { atomicWriteFileSync, BUREAU_DIR } from "../persistence/paths.ts";

export const THUMBNAIL_LIMIT = 1024 * 1024;
const root = join(BUREAU_DIR, "apps", "thumbnails");
function pathFor(app: AppRecord): string {
  if (!/^[a-z0-9-]+$/.test(app.hostLabel)) throw new Error("invalid app label");
  return join(root, `${app.hostLabel}.png`);
}
export function validateThumbnail(bytes: Buffer): void {
  if (bytes.length > THUMBNAIL_LIMIT || bytes.length < 45 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) || bytes.toString("ascii", 12, 16) !== "IHDR")
    throw new Error("Use a PNG image up to 1 MiB.");
  const width = bytes.readUInt32BE(16);
  const height = bytes.readUInt32BE(20);
  if (!width || !height || width > 4096 || height > 4096) throw new Error("Image dimensions must be between 1 and 4096 pixels.");
}
export function saveThumbnail(app: AppRecord, bytes: Buffer): void {
  validateThumbnail(bytes);
  mkdirSync(root, { recursive: true });
  atomicWriteFileSync(pathFor(app), bytes);
}
export function readThumbnail(app: AppRecord): Buffer | null {
  const path = pathFor(app);
  return existsSync(path) ? readFileSync(path) : null;
}
export function deleteThumbnail(app: AppRecord): void {
  rmSync(pathFor(app), { force: true });
}
export function thumbnailVersion(app: AppRecord): number | undefined {
  const path = pathFor(app);
  return existsSync(path) ? statSync(path).mtimeMs : undefined;
}
