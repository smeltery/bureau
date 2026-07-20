import { getFilePath } from "./persistence.ts";
import type { AttachmentSpec } from "./backends/types.ts";

export interface AttachmentNotice {
  originalName: string;
  mediaType: string;
  size: number;
  path: string;
}

export function resolveAttachmentNotices(agentId: string, specs: AttachmentSpec[]): AttachmentNotice[] {
  const notices: AttachmentNotice[] = [];
  for (const spec of specs) {
    const path = getFilePath(agentId, spec.filename);
    if (!path) continue;
    notices.push({
      originalName: spec.originalName,
      mediaType: spec.mediaType,
      size: spec.size,
      path,
    });
  }
  return notices;
}

export function formatAttachmentLines(notices: AttachmentNotice[]): string[] {
  return notices.map(
    (notice) =>
      `[Attachment: ${quoteOneLine(notice.originalName)} (${oneLine(notice.mediaType)}, ${formatSize(notice.size)}) saved at ${quoteOneLine(notice.path)}. If your reply depends on it, open it before answering about its contents.]`,
  );
}

export function quoteOneLine(value: string): string {
  return JSON.stringify(value).replace(/[\u2028\u2029]/g, (char) => `\\u${char.charCodeAt(0).toString(16)}`);
}

function oneLine(value: string): string {
  // eslint-disable-next-line no-control-regex
  return value.replace(/[\u0000-\u001f\u007f\u2028\u2029()"\\]/g, "_");
}

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown size";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`;
}
