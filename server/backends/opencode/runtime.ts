// Resolve the OpenCode CLI binary. Prefer PATH / OPENCODE_BINARY so CI and
// local installs stay light — we do not ship the multi-arch opencode npm
// packages (they are large and platform-specific).

import { existsSync } from "node:fs";

export function resolveOpenCodeBinary(env: NodeJS.ProcessEnv = process.env): string {
  const override = env.OPENCODE_BINARY?.trim();
  if (override) {
    if (!existsSync(override)) {
      throw new Error(`OPENCODE_BINARY is set to ${override}, but that path does not exist.`);
    }
    return override;
  }
  const fromPath = Bun.which("opencode", { PATH: env.PATH ?? "/usr/bin:/bin" });
  if (fromPath) return fromPath;
  throw new Error("OpenCode CLI not found. Install the `opencode` binary on PATH " + "(https://opencode.ai), or set OPENCODE_BINARY to its absolute path.");
}
