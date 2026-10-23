import type { LoginInstructions } from "../../backends/types.ts";
import { logMessage, type LogMessage } from "../../../shared/i18n/log-message.ts";
import { addLogEntry, emitEphemeralLog, rooms, type ManagedAgent } from "../state.ts";
import { openCodeEnvironmentId } from "../../backends/opencode/profiles/identity.ts";
import { getBackend } from "../../backends/index.ts";
import { buildSessionEnv } from "./session-env.ts";
import { claudeProjectDir, claudeSessionFileExists, validateCwd } from "./paths.ts";

export function diagnoseProcessExit(managed: ManagedAgent): LogMessage | null {
  const cwd = managed.info.cwd;
  try {
    validateCwd(cwd);
  } catch {
    return logMessage("logs.diagnostic.missingCwd", { cwd });
  }
  const env = envForHints(managed);
  if (managed.sessionId && !claudeSessionFileExists(cwd, managed.sessionId, env)) {
    return logMessage("logs.diagnostic.missingSession", { session: managed.sessionId.slice(0, 8) + "…", directory: claudeProjectDir(cwd, env) });
  }
  return null;
}

// Error-path env build for diagnostic hints. Resume preflights deliberately
// fail loudly on a broken envFile (an agent expecting custom creds must not
// silently fall through to host creds). Hint generators are different: they
// annotate an already-failed backend error, and a broken envFile here would
// mask the real cause. Swallow and return undefined — the hint just falls back
// to inspecting the default ~/.claude path, which is the worst-case-correct
// behavior when we can't resolve env.
export function envForHints(managed: ManagedAgent): { [key: string]: string | undefined } | undefined {
  try {
    return buildSessionEnv(managed);
  } catch {
    return undefined;
  }
}

export function isAuthErrorForAgent(managed: ManagedAgent | undefined, text: string): boolean {
  if (!managed) return false;
  return getBackend(managed.info.agentType).detectAuthError(text);
}

export async function emitLoginInstructions(agentId: string, managed: ManagedAgent | undefined) {
  if (!managed) return;
  const provider = managed.info.agentType === "codex" ? "codex" : managed.info.agentType === "claude" ? "claude" : null;
  const session = managed.session;
  let instructions: LoginInstructions;
  try {
    instructions = await getBackend(managed.info.agentType).getLoginInstructions({
      env: envForHints(managed),
      environmentId: openCodeEnvironmentId(managed.info.userId, rooms[managed.info.room]?.id),
      sessionId: managed.sessionId ?? undefined,
    });
  } catch {
    instructions = { text: "Could not check provider sign-in. Open Account → Connections to check or reconnect.", message: logMessage("logs.login.unknown") };
  }
  if (managed.session !== session) return;
  // Connections deep-link: system notice carries providerLogin so the log card
  // can open Account → Connections without embedding secrets or OAuth state.
  emitEphemeralLog(agentId, "system", instructions.message ?? instructions.text, provider ? { providerLogin: provider, openConnections: true } : undefined);
  for (const command of instructions.commands ?? []) {
    addLogEntry(agentId, "terminal-command", command, undefined, undefined, { terminal: { command } });
  }
}

export function emitLoginInstructionsIfAuth(agentId: string, managed: ManagedAgent | undefined, text: string) {
  if (managed && isAuthErrorForAgent(managed, text)) emitLoginInstructions(agentId, managed);
}
