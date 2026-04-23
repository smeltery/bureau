import { join } from "path";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "fs";
import { createHash } from "crypto";
import type { Attachment } from "../../shared/types.ts";
import { LOGS_DIR } from "./paths.ts";

// ---------------------------------------------------------------------------
// File storage (unified files/ directory with SHA256 dedup)
// ---------------------------------------------------------------------------

export const MAX_FILE_BYTES = 20 * 1024 * 1024; // 20MB

export const MIME_TO_EXTENSION: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/gif": "gif",
  "image/webp": "webp",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/markdown": "md",
  "text/csv": "csv",
  "application/json": "json",
  "text/xml": "xml",
  "application/xml": "xml",
  "text/yaml": "yaml",
  "text/html": "html",
  "text/css": "css",
};

export const EXTENSION_TO_MIME: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg",
  png: "image/png", gif: "image/gif", webp: "image/webp",
  pdf: "application/pdf",
  txt: "text/plain", md: "text/markdown", csv: "text/csv",
  json: "application/json", xml: "text/xml",
  yaml: "text/yaml", yml: "text/yaml",
  html: "text/html", css: "text/css",
};

/** Sanitize a filename: strip path components, replace unsafe chars, fallback to hash. */
function sanitizeFilename(name: string): string {
  // Strip directory components
  const base = name.replace(/.*[\/\\]/, "");
  // Replace anything that isn't alphanumeric, dot, dash, underscore, or space
  const clean = base.replace(/[^a-zA-Z0-9.\-_ ]/g, "_");
  return clean || "file";
}

/** Save a file buffer to disk. Returns an Attachment object or null on failure. */
export function saveFile(agentId: string, data: Buffer, mediaType: string, originalName: string): Attachment | null {
  try {
    if (data.length > MAX_FILE_BYTES) return null;

    const dir = join(LOGS_DIR, agentId, "files");
    mkdirSync(dir, { recursive: true });

    let filename = sanitizeFilename(originalName);
    let filepath = join(dir, filename);

    // If file with same name and content exists, reuse it (same upload repeated).
    // If same name but different content, add a numeric suffix.
    if (existsSync(filepath)) {
      const existingHash = createHash("sha256").update(readFileSync(filepath)).digest("hex");
      const newHash = createHash("sha256").update(data).digest("hex");
      if (existingHash === newHash) {
        return { filename, originalName, mediaType, size: data.length };
      }
      const dot = filename.lastIndexOf(".");
      const stem = dot > 0 ? filename.slice(0, dot) : filename;
      const ext = dot > 0 ? filename.slice(dot) : "";
      let i = 2;
      while (existsSync(filepath)) {
        filename = `${stem}_${i}${ext}`;
        filepath = join(dir, filename);
        i++;
      }
    }

    writeFileSync(filepath, data);
    return { filename, originalName, mediaType, size: data.length };
  } catch (err) {
    console.error("Failed to save file:", err);
    return null;
  }
}

/** Resolve a filename to its disk path, or null if invalid/missing. */
export function getFilePath(agentId: string, filename: string): string | null {
  // Block path traversal
  if (/[\/\\]/.test(filename) || /[\/\\]/.test(agentId)) return null;
  if (filename === "." || filename === "..") return null;
  // Try new files/ directory first, fall back to legacy images/
  const filePath = join(LOGS_DIR, agentId, "files", filename);
  if (existsSync(filePath)) return filePath;
  const legacyPath = join(LOGS_DIR, agentId, "images", filename);
  return existsSync(legacyPath) ? legacyPath : null;
}
