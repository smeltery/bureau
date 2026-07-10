import { readFileSync, statSync } from "fs";
import { basename } from "path";

import { mimeTypeForFilename } from "../../mime-types.ts";
import { saveFile } from "../../persistence.ts";
import type { AttachmentSpec } from "../types.ts";

export function attachmentFromPath(agentId: string, rawPath: unknown): AttachmentSpec | null {
  if (typeof rawPath !== "string" || rawPath.length === 0) return null;
  try {
    const st = statSync(rawPath);
    if (!st.isFile()) return null;
    return saveFile(agentId, readFileSync(rawPath), mimeTypeForFilename(rawPath), basename(rawPath));
  } catch {
    return null;
  }
}
