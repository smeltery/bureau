import { readFileSync, statSync } from "fs";

import { getFilePath } from "../../persistence.ts";
import type { AttachmentSpec } from "../types.ts";

const MAX_INLINE_ATTACHMENT_BYTES = 64 * 1024;

const INLINE_TEXT_MEDIA_PREFIXES = ["text/", "application/json", "application/xml", "application/yaml", "application/x-yaml", "application/javascript", "application/typescript"];

function isInlinableTextMedia(mediaType: string): boolean {
  return INLINE_TEXT_MEDIA_PREFIXES.some((prefix) => mediaType.startsWith(prefix));
}

export function buildCodexUserInput(text: string, attachments: AttachmentSpec[] | undefined, agentId: string): Array<Record<string, unknown>> {
  const inputs: Array<Record<string, unknown>> = [];
  if (text) {
    inputs.push({ type: "text", text, text_elements: [] });
  }
  if (attachments && attachments.length > 0) {
    const textChunks: string[] = [];
    for (const att of attachments) {
      const filePath = getFilePath(agentId, att.filename);
      if (!filePath) continue;
      if (att.mediaType.startsWith("image/")) {
        inputs.push({ type: "localImage", path: filePath });
      } else if (att.mediaType === "application/pdf") {
        textChunks.push(`Attached PDF "${att.originalName}" at ${filePath}`);
      } else if (isInlinableTextMedia(att.mediaType)) {
        try {
          const size = statSync(filePath).size;
          if (size > MAX_INLINE_ATTACHMENT_BYTES) {
            textChunks.push(`Attached file "${att.originalName}" (${size} bytes; exceeds ${MAX_INLINE_ATTACHMENT_BYTES}-byte inline cap). Path: ${filePath}`);
          } else {
            const content = readFileSync(filePath, "utf-8");
            textChunks.push(`--- File: ${att.originalName} ---\n${content}\n---`);
          }
        } catch {
          textChunks.push(`Attached file ${att.originalName} (could not read content) at ${filePath}`);
        }
      } else {
        textChunks.push(`Attached file "${att.originalName}" (${att.mediaType}) at ${filePath}`);
      }
    }
    if (textChunks.length > 0) {
      inputs.push({
        type: "text",
        text: textChunks.join("\n\n"),
        text_elements: [],
      });
    }
  }
  if (inputs.length === 0) {
    inputs.push({ type: "text", text: "", text_elements: [] });
  }
  return inputs;
}
