import { formatAttachmentLines, resolveAttachmentNotices } from "../../attachment-prompt.ts";
import type { AttachmentSpec } from "../types.ts";

export function buildCodexUserInput(text: string, attachments: AttachmentSpec[] | undefined, agentId: string): Array<Record<string, unknown>> {
  const inputs: Array<Record<string, unknown>> = [];
  if (text) {
    inputs.push({ type: "text", text, text_elements: [] });
  }
  const attachmentLines = formatAttachmentLines(resolveAttachmentNotices(agentId, attachments ?? []));
  if (attachmentLines.length > 0) {
    inputs.push({
      type: "text",
      text: attachmentLines.join("\n"),
      text_elements: [],
    });
  }
  if (inputs.length === 0) {
    inputs.push({ type: "text", text: "", text_elements: [] });
  }
  return inputs;
}
