import { rollSessionUsageOnResume } from "../../persistence.ts";
import { emit, officeConfig, rooms, type ManagedAgent } from "../state.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { memoryStore } from "../../memory-store.ts";
import { claudeProjectDir, claudeSessionFileExists, validateCwd } from "./paths.ts";
import { getBackend } from "../../backends/index.ts";
import type { BackendSession } from "../../backends/types.ts";
import { getUserById } from "../../users.ts";
import { buildSessionEnv } from "./session-env.ts";
import { runConsumer } from "./event-consumer.ts";
export { CLAUDE_NATIVE_BIN } from "./claude-native.ts";
export { buildSessionEnv } from "./session-env.ts";

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
  promise.catch(() => {});
  managed.pendingTurn = { promise, resolve, reject };
  return promise;
}

export { emitLoginInstructions } from "./diagnostics.ts";

// ---------------------------------------------------------------------------
// Session lifecycle: installSession / replaceSession / createSession
// ---------------------------------------------------------------------------

// Install a freshly-created session on managed and spawn its consumer. Caller
// is responsible for having closed/awaited any previous session first.
export function installSession(agentId: string, managed: ManagedAgent, session: BackendSession) {
  managed.session = session;
  managed.consumerPromise = runConsumer(agentId, managed, session);
}

export const SESSION_REPLACE_CONSUMER_DRAIN_TIMEOUT_MS = 5_000;

export async function waitForConsumerDrain(consumer: Promise<void>, timeoutMs = SESSION_REPLACE_CONSUMER_DRAIN_TIMEOUT_MS): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs);
  });
  try {
    const drained = await Promise.race([consumer.then(() => true).catch(() => true), timeout]);
    return drained;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// Swap the agent's session: close the current one, await its consumer to
// drain, install the new session + consumer. Rejects any in-flight turn so
// callers awaiting sendMessage's deferred don't hang.
export async function replaceSession(agentId: string, managed: ManagedAgent, newSession: BackendSession, consumerDrainTimeoutMs = SESSION_REPLACE_CONSUMER_DRAIN_TIMEOUT_MS) {
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
      await waitForConsumerDrain(oldConsumer, consumerDrainTimeoutMs);
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
    managed.info.privileged ?? false,
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
