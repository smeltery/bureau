import { existsSync } from "node:fs";
import { CLAUDE_NATIVE_BIN } from "../../agents/session/claude-native.ts";

type Environment = Record<string, string | undefined>;
const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";

/** Prefer the same bundled CLI used for agent sessions, without installing another copy. */
export function claudeLoginCommand(env: Environment = process.env, bundledBinary = CLAUDE_NATIVE_BIN): string | null {
  const binary = existsSync(bundledBinary) ? bundledBinary : Bun.which("claude", { PATH: env.PATH ?? "/usr/bin:/bin" });
  if (!binary) return null;
  // Match the credential store the sign-in probe/session uses. Never put API
  // keys or other environment secrets in a clipboard command or log card.
  const assignments = ["HOME", "CLAUDE_CONFIG_DIR"].flatMap((key) => (env[key]?.trim() ? [`${key}=${quote(env[key]!)}`] : []));
  return `${assignments.length ? `env ${assignments.join(" ")} ` : ""}${quote(binary)} auth login`;
}
