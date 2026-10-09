import { formatAttachmentLines, resolveAttachmentNotices } from "../../../attachment-prompt.ts";
import type { AttachmentSpec } from "../../types.ts";

export function buildPromptParts(text: string, attachments: AttachmentSpec[] | undefined, agentId: string): Array<{ type: "text"; text: string }> {
  const parts: Array<{ type: "text"; text: string }> = [];
  if (text) parts.push({ type: "text", text });
  const lines = formatAttachmentLines(resolveAttachmentNotices(agentId, attachments ?? []));
  if (lines.length > 0) parts.push({ type: "text", text: lines.join("\n") });
  if (parts.length === 0) parts.push({ type: "text", text: "" });
  return parts;
}
