import { basename } from "node:path";
import type { SharedBrowserAction } from "../../shared/integrations/browser-sharing.ts";
import { resolveEditorPathForAgent } from "../agent-manager.ts";
import { readTransferFile } from "../file-access/transfer-file.ts";

export function prepareBrowserUpload(agentId: string, input: Record<string, unknown>): SharedBrowserAction {
  if (typeof input.selector !== "string" || !input.selector || input.selector.length > 500) throw new Error("A file input selector is required");
  if (typeof input.path !== "string" || !input.path.trim() || input.path.length > 4096 || input.path.includes("\0")) throw new Error("A valid file path is required");
  const path = resolveEditorPathForAgent(agentId, input.path);
  if (!path) throw new Error("Agent file path unavailable");
  const bytes = readTransferFile(path, 1024 * 1024, "Upload requires a readable, non-sensitive regular file of at most 1 MiB.");
  const name =
    basename(path)
      .replace(/[\x00-\x1f\x7f-\x9f\u202a-\u202e\u2066-\u2069\\]/g, "_")
      .slice(0, 255) || "upload";
  return { action: "upload", selector: input.selector, file: { name, mimeType: Bun.file(name).type || "application/octet-stream", base64: bytes.toString("base64") } };
}
