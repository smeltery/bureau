import { rollSessionUsageOnResume } from "../../persistence.ts";
import { armMemoryNotice } from "../memory-notice.ts";
import { clearLiveTurn, emit, officeConfig, rooms, syncPendingPrompt, type ManagedAgent } from "../state.ts";
import { buildSystemPrompt } from "./system-prompt.ts";
import { memoryStore } from "../../memory-store.ts";
import { validateCwd } from "./paths.ts";
import { getBackend } from "../../backends/index.ts";
import type { BackendSession } from "../../backends/types.ts";
import { getUserById } from "../../users.ts";
import { buildSessionEnv } from "./session-env.ts";
import { runConsumer } from "./event-consumer.ts";
import { drainOnSettle } from "../../slides/generate.ts";
import { slideMode } from "../slides.ts";
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
  // Claim the anchor the caller already logged for this turn, if any (see
  // nextTurnAnchorEntryId). Claimed ONCE: clearing it here means a later turn
  // whose own anchor is logged after the send (the queued flush) starts
  // anchorless rather than inheriting someone else's message, and gets stamped by
  // addLogEntry when its own lands.
  const record = { promise, resolve, reject, anchorEntryId: managed.nextTurnAnchorEntryId };
  managed.pendingTurn = record;
  managed.nextTurnAnchorEntryId = null;
  // Slide Mode: whatever SETTLES this turn — turn_completed, error, clean stream
  // end, stream catch, session swap, kill, or the supersession reject above —
  // settles this promise exactly once. Draining the parked slide request from the
  // settle (not one specific site) guarantees a client that requested the turn
  // while it was in flight always gets a terminal slide/placeholder, never an
  // orphaned pending. `record` stays readable after pendingTurn is nulled, and its
  // anchor is read at settle time — so it sees an anchor the claim above missed
  // and addLogEntry stamped later (a turn with no user_message anchor at all —
  // never viewable in the deck — is a no-op).
  const settleAgentId = managed.info.id;
  drainOnSettle(
    promise,
    () => record.anchorEntryId,
    (entryId) => slideMode.onTurnSettled(settleAgentId, entryId),
  );
  return promise;
}

export { emitLoginInstructions } from "./diagnostics.ts";

// ---------------------------------------------------------------------------
// Session lifecycle: installSession / replaceSession / createSession
// ---------------------------------------------------------------------------

// Install a freshly-created session on managed and spawn its consumer. Caller
// is responsible for having closed/awaited any previous session first.
export function installSession(agentId: string, managed: ManagedAgent, session: BackendSession) {
  if (managed.turnStartedAt === 0 || (managed.info.state !== "thinking" && managed.info.state !== "tool_executing")) {
    clearLiveTurn(managed);
  }
  managed.session = session;
  managed.consumerPromise = runConsumer(agentId, managed, session);
  // The agent has a session again, so whatever reason it was without one no
  // longer describes the present. Callers that need the reason (the wake paths)
  // snapshot it before installing.
  managed.dormantReason = null;
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
  clearLiveTurn(managed);
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
    syncPendingPrompt(managed.info.id, managed);
  }
  armMemoryNotice(managed);
  // Preflight checks so failures surface as readable errors instead of the SDK's
  // opaque "Claude Code process exited with code 1".
  try {
    validateCwd(managed.info.cwd);
  } catch (err: any) {
    throw new Error(`cwd is invalid: ${err.message}. Click the agent name in the log view header to fix it.`);
  }
  // Compute env once so the resume preflight and session opts see the same
  // auth/config paths.
  const env = buildSessionEnv(managed);
  const backend = getBackend(managed.info.agentType);
  if (resumeSessionId) {
    const resumableError = backend.checkSessionResumable(resumeSessionId, {
      cwd: managed.info.cwd,
      env,
    });
    if (resumableError) {
      throw new Error(`${resumableError} Use /resume to pick a different session.`);
    }
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
    owner?.language ?? null,
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
  return resumeSessionId ? backend.resumeSession(resumeSessionId, opts) : backend.createSession(opts);
}
