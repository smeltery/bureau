import { unstable_v2_createSession, unstable_v2_resumeSession, type CanUseTool, type PermissionResult } from "@anthropic-ai/claude-agent-sdk";
import { FAMILY_TO_MODEL } from "../../../shared/types.ts";
import { existsSync } from "fs";
import { join } from "path";
import { readEnvFile, rollSessionUsageOnResume } from "../../persistence.ts";
import { createSafetyHooks } from "./safety/index.ts";
import { addLogEntry, agents, emit, emitEphemeralLog, officeConfig, rooms, updateState, type ManagedAgent } from "../state.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { claudeProjectDir, claudeSessionFileExists, validateCwd } from "./paths.ts";
import { LOGIN_INSTRUCTIONS, isAuthError, processMessage } from "./messages.ts";

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
// Permission prompts (bypass-mode canUseTool callback)
// ---------------------------------------------------------------------------

function requestPermission(managed: ManagedAgent, toolName: string, input: Record<string, unknown>, opts: Parameters<CanUseTool>[2]): Promise<PermissionResult> {
  const agentId = managed.info.id;
  return new Promise<PermissionResult>((resolve) => {
    const title = opts.title ?? `Claude wants to use ${toolName}`;
    const lines: string[] = [`**${title}**`];
    if (opts.description) lines.push(opts.description);
    if (opts.decisionReason) lines.push(`\n_${opts.decisionReason}_`);
    lines.push("");
    lines.push("Reply:");
    lines.push("  1. Allow — and don't ask again for similar calls this session");
    lines.push("  2. Allow — just this time");
    lines.push("  3. Deny");
    lines.push("");
    lines.push("Or type any other message to deny with that as the reason.");
    emitEphemeralLog(agentId, "system", lines.join("\n"));

    // If a prior pending permission was never resolved, deny it now so we don't leak.
    if (managed.pendingPermission) {
      try {
        managed.pendingPermission.resolve({ behavior: "deny", message: "Superseded by newer request." });
      } catch {}
    }
    managed.pendingPermission = {
      toolUseID: opts.toolUseID,
      input,
      suggestions: opts.suggestions,
      resolve,
    };
    updateState(agentId, "waiting_for_response");

    opts.signal.addEventListener(
      "abort",
      () => {
        if (managed.pendingPermission?.toolUseID === opts.toolUseID) {
          managed.pendingPermission = null;
          resolve({ behavior: "deny", message: "Request aborted." });
        }
      },
      { once: true },
    );
  });
}

// ---------------------------------------------------------------------------
// Environment merging for sessions (office + room dotenv layering)
// ---------------------------------------------------------------------------

// Merge process.env with office and room env files.
// Room overrides office; office overrides process.env. Spawn-time failure mode:
// if a configured env file is missing or fails to parse, throw — the caller is
// responsible for surfacing the error to the agent log.
export function buildSessionEnv(managed: ManagedAgent): { [key: string]: string | undefined } | undefined {
  const room = rooms[managed.info.room];
  const roomEnvFile = room?.envFile ?? null;
  const officeEnvFile = officeConfig.envFile;
  if (!roomEnvFile && !officeEnvFile) return undefined;

  // Intentional: inherit parent process.env so agents see HOME/PATH/etc. Office
  // and room files override individual keys but cannot unset inherited ones.
  const merged: { [key: string]: string | undefined } = { ...process.env };
  if (officeEnvFile) {
    const officeEnv = readEnvFile(officeEnvFile);
    Object.assign(merged, officeEnv);
  }
  if (roomEnvFile) {
    const roomEnv = readEnvFile(roomEnvFile);
    Object.assign(merged, roomEnv);
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
async function runConsumer(agentId: string, managed: ManagedAgent, boundSession: ReturnType<typeof unstable_v2_createSession>) {
  while (agents.has(agentId) && managed.session === boundSession) {
    try {
      for await (const msg of boundSession.stream()) {
        // After an abort/resume/fork the dying session may keep yielding
        // messages for several seconds before its stream() generator finally
        // ends (the SDK's close() doesn't interrupt mid-chunk). We must keep
        // draining so the inner generator terminates, but we drop the events
        // — otherwise the user sees model output continuing after Ctrl+C.
        if (managed.session !== boundSession) continue;
        processMessage(agentId, msg);
      }
      // Inner generator ended: either the turn's `result` arrived, or the
      // session was closed from underneath us. Resolve any pending turn; the
      // outer loop re-calls stream() which blocks until the next event.
      const turn = managed.pendingTurn;
      if (turn && managed.session === boundSession) {
        managed.pendingTurn = null;
        turn.resolve();
      }
    } catch (err: any) {
      if (managed.aborting || managed.session !== boundSession) {
        // Expected: abort() or a session swap closed us. The swap path
        // already nulled + rejected pendingTurn with SessionSwappedError.
        return;
      }

      const turn = managed.pendingTurn;
      managed.pendingTurn = null;
      if (turn) turn.reject(err);

      console.error(`Agent ${agentId} stream error:`, err.message);
      const errorText = `Stream error: ${err.message}`;
      addLogEntry(agentId, "error", errorText);
      // The SDK's "process exited with code 1" is opaque; diagnose common causes.
      const hints = diagnoseProcessExit(managed);
      if (hints) emitEphemeralLog(agentId, "system", hints);
      if (isAuthError(errorText)) {
        emitEphemeralLog(agentId, "system", LOGIN_INSTRUCTIONS);
      }
      updateState(agentId, "error");
      return;
    }
  }
}

// Install a freshly-created session on managed and spawn its consumer. Caller
// is responsible for having closed/awaited any previous session first.
export function installSession(agentId: string, managed: ManagedAgent, session: ReturnType<typeof unstable_v2_createSession>) {
  managed.session = session;
  managed.consumerPromise = runConsumer(agentId, managed, session);
}

// Swap the agent's session: close the current one, await its consumer to
// drain, install the new session + consumer. Rejects any in-flight turn so
// callers awaiting sendMessage's deferred don't hang.
export async function replaceSession(agentId: string, managed: ManagedAgent, newSession: ReturnType<typeof unstable_v2_createSession>) {
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
    try {
      managed.pendingPermission.resolve({ behavior: "deny", message: "Session restarted." });
    } catch {}
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
  if (resumeSessionId && !claudeSessionFileExists(managed.info.cwd, resumeSessionId, env)) {
    throw new Error(
      `Cannot resume session ${resumeSessionId.slice(0, 8)}…: its file is missing from ${claudeProjectDir(managed.info.cwd, env)}. ` +
        `Most commonly this happens after the agent's cwd was moved or renamed — the Claude CLI stores sessions under a path derived from cwd. ` +
        `Use /resume to pick a different session, or move the session .jsonl into the new project dir.`,
    );
  }
  const room = rooms[managed.info.room]!;
  const systemPrompt = buildSystemPrompt(managed.info.name, managed.info.id, room.name, officeConfig.prompt, room.prompt, managed.info.customInstructions);
  // V2 SDKSessionOptions still doesn't expose systemPrompt / extraArgs, so we
  // inject --append-system-prompt via executableArgs. When
  // pathToClaudeCodeExecutable is a native binary, executableArgs are prepended
  // to the CLI args verbatim (verified against SDK 0.2.116 sdk.mjs).
  const opts: any = {
    model: FAMILY_TO_MODEL[managed.info.modelFamily],
    permissionMode: managed.info.permissionMode,
    pathToClaudeCodeExecutable: CLAUDE_NATIVE_BIN,
    executableArgs: ["--append-system-prompt", systemPrompt],
    cwd: managed.info.cwd,
    hooks: createSafetyHooks(),
    canUseTool: ((toolName, input, options) => requestPermission(managed, toolName, input, options)) as CanUseTool,
  };
  if (env) opts.env = env;
  if (resumeSessionId) {
    opts.resume = resumeSessionId;
    // The SDK reports cost cumulative-per-process, so a resumed session's
    // counter starts from zero. Roll the current-run usage into the
    // prior-runs accumulator so lifetime cost survives the reset.
    rollSessionUsageOnResume(managed.info.id, resumeSessionId);
  }
  return resumeSessionId ? unstable_v2_resumeSession(resumeSessionId, opts) : unstable_v2_createSession(opts);
}
