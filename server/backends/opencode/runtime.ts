import { BureauLogError } from "../../../shared/i18n/backend-errors/error.ts";
import { logMessage } from "../../../shared/i18n/log-message.ts";
// Resolve the OpenCode CLI binary. Prefer PATH / OPENCODE_BINARY so CI and
// local installs stay light — we do not ship the multi-arch opencode npm
// packages (they are large and platform-specific).

import { existsSync } from "node:fs";

export function resolveOpenCodeBinary(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENCODE_BINARY?.trim();
  if (override) {
    if (!existsSync(override)) {
      throw new BureauLogError(logMessage("logs.backendError.binaryPath", { path: override }));
    }
    return override;
  }
  const fromPath = Bun.which("opencode", { PATH: env.PATH ?? "/usr/bin:/bin" });
  if (fromPath) return fromPath;
  throw new BureauLogError(logMessage("logs.backendError.binaryMissing"));
}
