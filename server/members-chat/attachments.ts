import { randomUUID } from "node:crypto";
import { join, extname } from "node:path";
import { mkdirSync, lstatSync, readFileSync, writeFileSync, unlinkSync } from "node:fs";
import type { Attachment } from "../../shared/log-types.ts";
import { atomicWriteFileSync } from "../persistence/paths.ts";
import { MAX_FILE_BYTES, MIME_TO_EXTENSION } from "../persistence/files.ts";
import { mimeTypeForFilename } from "../mime-types.ts";

export const CHAT_MAX_FILES = 5;
export const CHAT_MAX_TOTAL_BYTES = 400 * 1024 * 1024;
const FILE_NAME = /^[a-f0-9]{32}\.[a-z0-9]{1,12}$/;

export function createChatAttachments(dir: string) {
  const files = join(dir, "files");
  function regular(path: string): boolean {
    try {
      return lstatSync(path).isFile();
    } catch {
      return false;
    }
  }
  function getAttachment(filename: string): Attachment | null {
    if (!FILE_NAME.test(filename)) return null;
    const path = join(files, filename);
    const metadata = path + ".meta.json";
    if (!regular(path) || !regular(metadata)) return null;
    try {
      const stored = JSON.parse(readFileSync(metadata, "utf8"));
      if (stored.filename !== filename || typeof stored.originalName !== "string" || stored.mediaType !== mimeTypeForFilename(filename) || stored.size !== lstatSync(path).size) return null;
      return { filename, originalName: stored.originalName, mediaType: stored.mediaType, size: stored.size };
    } catch {
      return null;
    }
  }
  function attachmentPath(filename: string): string | null {
    return getAttachment(filename) ? join(files, filename) : null;
  }
  function saveAttachment(data: Buffer, mediaType: string, originalName: string): Attachment {
    if (data.length > MAX_FILE_BYTES) throw new Error("File exceeds upload limit");
    const originalExtension = extname(originalName).slice(1).toLowerCase();
    const fallback = Object.hasOwn(MIME_TO_EXTENSION, mediaType) ? MIME_TO_EXTENSION[mediaType]! : "bin";
    const extension = /^[a-z0-9]{1,12}$/.test(originalExtension) ? originalExtension : fallback;
    const filename = randomUUID().replaceAll("-", "") + "." + extension;
    const attachment = { filename, originalName: Array.from(originalName).slice(0, 2048).join(""), mediaType: mimeTypeForFilename(filename), size: data.length };
    mkdirSync(files, { recursive: true });
    const path = join(files, filename);
    writeFileSync(path, data, { flag: "wx" });
    try {
      atomicWriteFileSync(path + ".meta.json", JSON.stringify(attachment) + "\n");
    } catch (error) {
      unlinkSync(path);
      throw error;
    }
    return attachment;
  }
  return { getAttachment, attachmentPath, saveAttachment };
}
