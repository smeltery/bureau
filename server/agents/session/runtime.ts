import type { AgentState } from "../../../shared/types.ts";
import { existsSync } from "fs";
import { join } from "path";
import { accumulateSessionUsage, appendSessionUsageSnapshot, readEnvFile, rollSessionUsageOnResume, loadLogWithAncestors, appendLog, ensureSessionCwd } from "../../persistence.ts";
import { addLogEntry, agents, emit, emitEphemeralLog, logCache, officeConfig, persistAll, rooms, updateState, type ManagedAgent } from "../state.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { memoryStore } from "../../memory-store.ts";
import { claudeProjectDir, claudeSessionFileExists, validateCwd } from "./paths.ts";
import { autocompleteCommands } from "../commands.ts";
import { deduplicateSkills, discoverBundledSkills, discoverPluginSkills, discoverProjectSkills, discoverUserSkills } from "../skills-discovery.ts";
import { getBackend } from "../../backends/index.ts";
import type { BackendSession, NormalizedEvent } from "../../backends/types.ts";
import { getUserById } from "../../users.ts";

export function buildMemoryPromptForAgent(managed: ManagedAgent): string | null {
  const room = rooms[managed.info.room];
  if (!room) return null;
  return memoryStore.renderForPromptMulti([
    { scope: "office", scopeId: null, label: "Office-wide" },
    { scope: "room", scopeId: room.id, label: `Room "${room.name}"` },
    ...(managed.info.userId ? [{ scope: "boss" as const, scopeId: managed.info.userId, label: "Your boss" }] : []),
    { scope: "agent", scopeId: managed.info.id, label: `Agent "${managed.info.name}"` },
  ]);
}

export function managerNameForAgent(managed: ManagedAgent): string | null {
  return managed.info.userId ? (getUserById(managed.info.userId)?.name ?? null) : null;
}

// ---------------------------------------------------------------------------
// Claude CLI native binary resolution
// ---------------------------------------------------------------------------

// Path to the Claude CLI native binary that ships with the Agent SDK.
// The SDK's auto-resolver tries the musl variant first on Linux, which fails
// on glibc systems (ENOENT on /lib/ld-musl-*.so.1 when execve runs the binary).
// We resolve explicitly and pass it as pathToClaudeCodeExecutable so every
// libc gets the right binary.
export const CLAUDE_NATIVE_BIN = resolveClaudeNativeBinary();

function resolveClaudeNativeBinary(): string {
  const anthropicDir = join(import.meta.dir, "..", "..", "..", "node_modules", "@anthropic-ai");
  const binName = process.platform === "win32" ? "claude.exe" : "claude";
  if (process.platform === "linux") {
    const muslArch = process.arch === "arm64" ? "aarch64" : "x86_64";
    const isMusl = existsSync(`/lib/ld-musl-${muslArch}.so.1`);
    const variants = isMusl ? [`linux-${process.arch}-musl`, `linux-${process.arch}`] : [`linux-${process.arch}`, `linux-${process.arch}-musl`];
    for (const v of variants) {
      const p = join(anthropicDir, `claude-agent-sdk-${v}`, binName);
      if (existsSync(p)) return p;
    }
  }
  return join(anthropicDir, `claude-agent-sdk-${process.platform}-${process.arch}`, binName);
}

// ---------------------------------------------------------------------------
// Error types + per-turn deferreds
// ---------------------------------------------------------------------------

// Thrown at an in-flight turn's deferred when its session is swapped out
// from under it (abort / resume / model switch / etc.). Callers of
// sendMessage / executeSkill / editMessage filter this out so a user-
// initiated interrupt doesn't surface as a scary log entry.
export class SessionSwappedError extends Error {
  constructor(message = "Session replaced.") {
    super(message);
    this.name = "SessionSwappedError";
  }
}

// Create the per-turn deferred that sendMessage / executeSkill await. The
// persistent consumer resolves it when its inner `stream()` iterator ends —
// which, per the V2 SDK contract, happens exactly at the turn's `result`
// message. If the SDK ever emits an empty stream between turns, this
// deferred would resolve prematurely; the invariant is load-bearing.
export function createTurnDeferred(managed: ManagedAgent): Promise<void> {
  // Any stale pending turn (shouldn't normally happen; agents are
  // state-gated to one turn at a time) gets rejected so awaiting callers
  // don't leak forever.
  const stale = managed.pendingTurn;
  if (stale) {
    managed.pendingTurn = null;
    try {
      stale.reject(new Error("Superseded by a new turn."));
    } catch {}
  }
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  managed.pendingTurn = { resolve, reject };
  return promise;
}

// ---------------------------------------------------------------------------
// Environment merging for sessions (office + room + user dotenv layering)
// ---------------------------------------------------------------------------

// Merge process.env with office, room, and user env files.
// User overrides room, room overrides office, office overrides process.env. Spawn-time failure mode:
// if a configured env file is missing or fails to parse, throw — the caller is
// responsible for surfacing the error to the agent log.
export function buildSessionEnv(managed: ManagedAgent): { [key: string]: string | undefined } | undefined {
  const room = rooms[managed.info.room];
  const roomEnvFile = room?.envFile ?? null;
  const officeEnvFile = officeConfig.envFile;
  const userEnvFile = managed.info.userId ? (getUserById(managed.info.userId)?.envFile ?? null) : null;
  if (!roomEnvFile && !officeEnvFile && !userEnvFile) return undefined;

  // Intentional: inherit parent process.env so agents see HOME/PATH/etc. Office
  // room, and user files override individual keys but cannot unset inherited ones.
  const merged: { [key: string]: string | undefined } = { ...process.env };
  if (officeEnvFile) {
    const officeEnv = readEnvFile(officeEnvFile);
    Object.assign(merged, officeEnv);
  }
  if (roomEnvFile) {
    const roomEnv = readEnvFile(roomEnvFile);
    Object.assign(merged, roomEnv);
  }
  if (userEnvFile) {
    const userEnv = readEnvFile(userEnvFile);
    Object.assign(merged, userEnv);
  }
  return merged;
}

// ---------------------------------------------------------------------------
// Diagnostics for opaque SDK exit codes
// ---------------------------------------------------------------------------

// Produce a human-readable hint for why the Claude CLI subprocess may have died,
// to go alongside the SDK's generic "process exited with code 1". Returns null if
// no specific cause is identifiable.
//
// Resolves session paths against the same CLAUDE_CONFIG_DIR the spawn used by
// reading env via envForHints (best-effort: a broken envFile must not mask the
// original backend error this hint is annotating).
function diagnoseProcessExit(managed: ManagedAgent): string | null {
  const cwd = managed.info.cwd;
  try {
    validateCwd(cwd);
  } catch {
    return `Likely cause: cwd \`${cwd}\` no longer exists. Click the agent name in the log view header to point it at a valid directory.`;
  }
  const env = envForHints(managed);
  if (managed.sessionId && !claudeSessionFileExists(cwd, managed.sessionId, env)) {
    return (
      `Likely cause: session \`${managed.sessionId.slice(0, 8)}…\` was not found in \`${claudeProjectDir(cwd, env)}\`. ` +
      `This usually happens after cwd was moved/renamed — the Claude CLI locates session files by a path derived from cwd. ` +
      `Use /resume to pick another session, or move the session .jsonl into the new project dir.`
    );
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
function envForHints(managed: ManagedAgent): { [key: string]: string | undefined } | undefined {
  try {
    return buildSessionEnv(managed);
  } catch {
    return undefined;
  }
}

function isAuthErrorForAgent(managed: ManagedAgent | undefined, text: string): boolean {
  if (!managed) return false;
  return getBackend(managed.info.agentType).detectAuthError(text);
}

export function emitLoginInstructions(agentId: string, managed: ManagedAgent | undefined) {
  if (!managed) return;
  const instructions = getBackend(managed.info.agentType).getLoginInstructions({ env: envForHints(managed) });
  emitEphemeralLog(agentId, "system", instructions.text);
  for (const command of instructions.commands ?? []) {
    addLogEntry(agentId, "terminal-command", command, undefined, undefined, { terminal: { command } });
  }
}

function emitLoginInstructionsIfAuth(agentId: string, managed: ManagedAgent | undefined, text: string) {
  if (managed && isAuthErrorForAgent(managed, text)) emitLoginInstructions(agentId, managed);
}

// ---------------------------------------------------------------------------
// Session lifecycle: runConsumer / installSession / replaceSession / createSession
// ---------------------------------------------------------------------------

// Persistent consumer. Runs for the session's lifetime, iterating `stream()`
// in a loop so events that arrive between turns (notably `task_notification`
// from backgrounded Bash) get processed promptly instead of being held until
// the next user turn. See docs/held-back-messages-investigation.md.
//
// Bound to a specific session instance: loop exits when `managed.session` is
// swapped out (abort / resume / fork / etc.) — `session.close()` unblocks the
// parked `stream()` generator.
async function runConsumer(agentId: string, managed: ManagedAgent, boundSession: BackendSession) {
  try {
    for await (const ev of boundSession.stream()) {
      if (managed.session !== boundSession) continue;
      if (managed.aborting && ev.kind !== "turn_completed" && ev.kind !== "error") continue;
      processNormalizedEvent(agentId, ev);
    }
  } catch (err: any) {
    if (managed.aborting || managed.session !== boundSession) return;
    const turn = managed.pendingTurn;
    managed.pendingTurn = null;
    if (turn) turn.reject(err);
    const errorText = `Stream error: ${err.message ?? String(err)}`;
    addLogEntry(agentId, "error", errorText);
    if (managed.info.agentType === "claude") {
      const hints = diagnoseProcessExit(managed);
      if (hints) emitEphemeralLog(agentId, "system", hints);
    }
    emitLoginInstructionsIfAuth(agentId, managed, errorText);
    updateState(agentId, isAuthErrorForAgent(managed, errorText) ? "waiting_for_response" : "error");
  }
}

function deriveStateFromEvent(ev: NormalizedEvent): AgentState | null {
  switch (ev.kind) {
    case "assistant_text":
    case "thinking":
      return "thinking";
    case "tool_call":
      return "tool_executing";
    case "turn_completed":
      return ev.status === "completed" ? "waiting_for_response" : null;
    default:
      return null;
  }
}

function processNormalizedEvent(agentId: string, ev: NormalizedEvent) {
  const newState = deriveStateFromEvent(ev);
  if (newState) {
    const currentState = agents.get(agentId)?.info.state;
    if (!(currentState === "tool_executing" && newState === "thinking")) updateState(agentId, newState);
  }

  switch (ev.kind) {
    case "system_init": {
      const managed = agents.get(agentId);
      if (managed && ev.sessionId) {
        const hadPreviousSession = !!managed.sessionId;
        if (!managed.sessionId) {
          const history = loadLogWithAncestors(agentId, ev.sessionId);
          for (const entry of history) emit({ type: "log_entry", entry });
        }
        if (hadPreviousSession && ev.sessionId !== managed.sessionId) {
          emit({ type: "clear_logs", agentId } as any);
          addLogEntry(agentId, "system", "Conversation cleared.");
        }
        managed.sessionId = ev.sessionId;
        // Record the cwd this session was born in (source of truth for
        // per-session cwd). Idempotent: a fork already stamped its cwd via
        // persistSessionFork so this no-ops there; a plain fresh session
        // (spawn / new conversation) gets the agent's current mirror cwd here.
        ensureSessionCwd(agentId, ev.sessionId, managed.info.cwd);
        if (!hadPreviousSession) {
          for (const entry of logCache.get(agentId) ?? []) appendLog(agentId, ev.sessionId, entry);
        }
        persistAll();
      }
      const filteredSdkCommands = (ev.slashCommands ?? []).filter((c) => !c.startsWith("mcp__"));
      if (managed) {
        managed.sdkReportedCommands = filteredSdkCommands;
        managed.slashCommands = autocompleteCommands();
        managed.skills = deduplicateSkills([...discoverUserSkills(), ...discoverProjectSkills(managed.info.cwd), ...discoverPluginSkills(), ...discoverBundledSkills()]);
        emit({ type: "slash_commands", agentId, commands: managed.slashCommands, skills: managed.skills } as any);
      }
      break;
    }
    case "assistant_text":
      addLogEntry(agentId, "text", ev.text);
      break;
    case "system_text": {
      addLogEntry(agentId, "system", ev.text);
      const managed = agents.get(agentId);
      emitLoginInstructionsIfAuth(agentId, managed, ev.text);
      break;
    }
    case "thinking": {
      const managed = agents.get(agentId);
      const duration_ms = ev.durationMs ?? (managed?.thinkingStartedAt ? Date.now() - managed.thinkingStartedAt : undefined);
      addLogEntry(agentId, "thinking", ev.text, duration_ms != null ? { duration_ms } : undefined);
      break;
    }
    case "tool_call": {
      const managed = agents.get(agentId);
      if (managed) managed.toolCallTimestamps.set(ev.toolUseId, Date.now());
      addLogEntry(agentId, "tool_call", ev.name, { toolId: ev.toolUseId, input: ev.input });
      break;
    }
    case "tool_result": {
      const managed = agents.get(agentId);
      const callStart = managed?.toolCallTimestamps.get(ev.toolUseId);
      const duration_ms = ev.durationMs ?? (callStart ? Date.now() - callStart : undefined);
      if (managed && callStart) managed.toolCallTimestamps.delete(ev.toolUseId);
      addLogEntry(
        agentId,
        "tool_result",
        ev.content.slice(0, 10000),
        { toolUseId: ev.toolUseId, ...(duration_ms != null ? { duration_ms } : {}), ...(ev.isError != null ? { isError: ev.isError } : {}) },
        ev.attachments,
      );
      break;
    }
    case "turn_completed": {
      const managed = agents.get(agentId);
      if (managed?.sessionId && ev.usage) {
        const cumulative = accumulateSessionUsage(agentId, managed.sessionId, ev.usage, ev.cost ?? 0);
        if (managed.lastWrittenEntryId) appendSessionUsageSnapshot(agentId, managed.sessionId, managed.lastWrittenEntryId, cumulative);
      }
      if (managed && ev.status !== "completed") {
        const isInterrupted = managed.aborting && ev.status === "interrupted";
        if (!isInterrupted) {
          const errorText = ev.error ?? `Agent stopped: ${ev.status}.`;
          addLogEntry(agentId, "error", errorText);
          const auth = ev.causedByAuth === true || isAuthErrorForAgent(managed, errorText);
          if (ev.causedByAuth !== true && auth) emitLoginInstructions(agentId, managed);
          updateState(agentId, auth ? "waiting_for_response" : "error");
        }
      }
      const turn = managed?.pendingTurn;
      if (managed && turn) {
        managed.pendingTurn = null;
        turn.resolve();
      }
      break;
    }
    case "usage_update": {
      const managed = agents.get(agentId);
      if (managed?.sessionId) {
        const cumulative = accumulateSessionUsage(agentId, managed.sessionId, ev.tokenUsage, 0);
        if (managed.lastWrittenEntryId) appendSessionUsageSnapshot(agentId, managed.sessionId, managed.lastWrittenEntryId, cumulative);
      }
      break;
    }
    case "compacted":
      addLogEntry(agentId, "system", ev.summary ? `Context compacted: ${ev.summary}` : "Context compacted.");
      break;
    case "file_view":
      addLogEntry(agentId, "file-view", ev.title, undefined, ev.attachments);
      break;
    case "error": {
      const managed = agents.get(agentId);
      addLogEntry(agentId, "error", ev.message);
      if (managed?.info.agentType === "claude") {
        const hints = diagnoseProcessExit(managed);
        if (hints) emitEphemeralLog(agentId, "system", hints);
      }
      emitLoginInstructionsIfAuth(agentId, managed, ev.message);
      const turn = managed?.pendingTurn;
      if (managed && turn) {
        managed.pendingTurn = null;
        turn.reject(new Error(ev.message));
      }
      updateState(agentId, managed && isAuthErrorForAgent(managed, ev.message) ? "waiting_for_response" : "error");
      break;
    }
    case "approval_request": {
      const managed = agents.get(agentId);
      if (!managed) break;
      const lines = [`**${ev.title ?? `Wants to use ${ev.toolName}`}**`];
      if (ev.description) lines.push(ev.description);
      lines.push(
        "",
        "Reply:",
        "  1. Allow — and don't ask again for similar calls this session",
        "  2. Allow — just this time",
        "  3. Deny",
        "",
        "Or type any other message to deny with that as the reason.",
      );
      emitEphemeralLog(agentId, "system", lines.join("\n"));
      managed.pendingPermission = { approvalId: ev.approvalId, toolName: ev.toolName };
      updateState(agentId, "waiting_for_response");
      break;
    }
  }
}

// Install a freshly-created session on managed and spawn its consumer. Caller
// is responsible for having closed/awaited any previous session first.
export function installSession(agentId: string, managed: ManagedAgent, session: BackendSession) {
  managed.session = session;
  managed.consumerPromise = runConsumer(agentId, managed, session);
}

// Swap the agent's session: close the current one, await its consumer to
// drain, install the new session + consumer. Rejects any in-flight turn so
// callers awaiting sendMessage's deferred don't hang.
export async function replaceSession(agentId: string, managed: ManagedAgent, newSession: BackendSession) {
  // Bump the cancel token first so any concurrent runAgentTurn in its
  // pre-send plugin-retrieval window bails on the next await checkpoint —
  // the in-flight `pendingTurn` rejection below only covers the post-send
  // path. /clear, /resume, /model, edit-fork, and abort's slow path all
  // funnel through here, so this single bump covers every swap.
  managed.turnCancelToken++;
  managed.info = { ...managed.info, sessionSwapping: true };
  emit({ type: "agent_updated", agentId, changes: { sessionSwapping: true } });
  try {
    const oldConsumer = managed.consumerPromise;
    const turn = managed.pendingTurn;
    managed.pendingTurn = null;
    if (turn) {
      try {
        turn.reject(new SessionSwappedError());
      } catch {}
    }
    try {
      managed.session?.close();
    } catch {}
    managed.session = null;
    if (oldConsumer) {
      try {
        await oldConsumer;
      } catch {}
    }
    installSession(agentId, managed, newSession);
  } finally {
    managed.info = { ...managed.info, sessionSwapping: false };
    emit({ type: "agent_updated", agentId, changes: { sessionSwapping: false } });
  }
}

export function createSession(managed: ManagedAgent, resumeSessionId?: string) {
  // Drop any pending permission prompt from a prior (now-closed) session so the
  // next user message isn't swallowed by a dead request.
  if (managed.pendingPermission) {
    managed.pendingPermission = null;
  }
  // Preflight checks so failures surface as readable errors instead of the SDK's
  // opaque "Claude Code process exited with code 1".
  try {
    validateCwd(managed.info.cwd);
  } catch (err: any) {
    throw new Error(`cwd is invalid: ${err.message}. Click the agent name in the log view header to fix it.`);
  }
  // Compute env once — both the resume preflight (Claude sessions dir lookup
  // honors CLAUDE_CONFIG_DIR) and the session opts use it.
  const env = buildSessionEnv(managed);
  if (managed.info.agentType === "claude" && resumeSessionId && !claudeSessionFileExists(managed.info.cwd, resumeSessionId, env)) {
    throw new Error(
      `Cannot resume session ${resumeSessionId.slice(0, 8)}…: its file is missing from ${claudeProjectDir(managed.info.cwd, env)}. ` +
        `Most commonly this happens after the agent's cwd was moved or renamed — the Claude CLI stores sessions under a path derived from cwd. ` +
        `Use /resume to pick a different session, or move the session .jsonl into the new project dir.`,
    );
  }
  const room = rooms[managed.info.room]!;
  const memoryPrompt = buildMemoryPromptForAgent(managed);
  const owner = managed.info.userId ? getUserById(managed.info.userId) : null;
  const systemPrompt = buildSystemPrompt(
    managed.info.name,
    managed.info.id,
    room.name,
    officeConfig.prompt,
    room.prompt,
    managed.info.customInstructions,
    memoryPrompt,
    owner?.name ?? null,
    owner?.memberPrompt ?? null,
  );
  // V2 SDKSessionOptions still doesn't expose systemPrompt / extraArgs, so we
  // inject --append-system-prompt via executableArgs. When
  // pathToClaudeCodeExecutable is a native binary, executableArgs are prepended
  // to the CLI args verbatim (verified against SDK 0.2.116 sdk.mjs).
  const opts = {
    agentId: managed.info.id,
    modelFamily: managed.info.modelFamily,
    effort: managed.info.effort ?? "xhigh",
    permissionMode: managed.info.permissionMode,
    sandbox: managed.info.codexSandbox,
    systemPrompt,
    cwd: managed.info.cwd,
  };
  if (env) (opts as any).env = env;
  if (resumeSessionId) {
    // The SDK reports cost cumulative-per-process, so a resumed session's
    // counter starts from zero. Roll the current-run usage into the
    // prior-runs accumulator so lifetime cost survives the reset.
    rollSessionUsageOnResume(managed.info.id, resumeSessionId);
  }
  const backend = getBackend(managed.info.agentType);
  return resumeSessionId ? backend.resumeSession(resumeSessionId, opts) : backend.createSession(opts);
}
