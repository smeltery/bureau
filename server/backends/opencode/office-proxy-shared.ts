import { join } from "node:path";
import { BUREAU_DIR } from "../../persistence/paths.ts";

export const OPENCODE_TURN_HANDLE_PLACEHOLDER = "__BUREAU_OPENCODE_TURN__";

export function openCodeAuthoritySocketPath(): string {
  return join(BUREAU_DIR, "opencode", "authority", "authority.sock");
}
