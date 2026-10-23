import type { ManagedAgent } from "../state.ts";
import { ensureSessionClaudeConfigDir, ensureSessionCodexHome, getSessionClaudeConfigDir, getSessionCodexHome } from "../../persistence.ts";
import { BUREAU_CODEX_HOME } from "../../backends/codex/native-bin.ts";
import { buildSessionEnv } from "./session-env.ts";
import { claudeConfigRoot } from "./paths.ts";

/** Existing conversations keep the store they started in when a personal account is activated. */
export function pinProviderEnvironment(managed: Pick<ManagedAgent, "info">, sessionId: string | null | undefined, env: Record<string, string | undefined> | undefined) {
  if (!sessionId) return env;
  if (managed.info.agentType === "claude") {
    const root = getSessionClaudeConfigDir(managed.info.id, sessionId) ?? ensureSessionClaudeConfigDir(managed.info.id, sessionId, claudeConfigRoot(buildSessionEnv(managed, false)));
    return { ...(env ?? process.env), CLAUDE_CONFIG_DIR: root };
  }
  if (managed.info.agentType === "codex") {
    const root = getSessionCodexHome(managed.info.id, sessionId) ?? ensureSessionCodexHome(managed.info.id, sessionId, buildSessionEnv(managed, false)?.CODEX_HOME || BUREAU_CODEX_HOME);
    return { ...(env ?? process.env), CODEX_HOME: root };
  }
  return env;
}
