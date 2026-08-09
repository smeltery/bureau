import type { AgentInfo, AgentSubscriptionUsage, KilledAgentSummary, LogEntry, RoomWire, SkillInfo } from "../../shared/types.ts";
import type { BackendSession } from "../backends/types.ts";

// Internal agent state
export interface ManagedAgent {
  info: AgentInfo;
  session: BackendSession | null;
  sessionId: string | null;
  lastActivityAt: number;
  // Persistent consumer loop iterating `session.stream()` for the session's
  // lifetime. See docs/held-back-messages-investigation.md — without this,
  // task_notifications buffered between turns get flushed one turn late.
  consumerPromise: Promise<void> | null;
  // Per-turn deferred. sendMessage/executeSkill await this; the consumer
  // resolves it when the turn's `stream()` iterator ends at `result`.
  pendingTurn: { promise: Promise<void>; resolve: () => void; reject: (err: unknown) => void } | null;
  // The aggregate `afterTurn` promise for the most recent turn — all plugins'
  // afterTurn hooks raced against their per-plugin timeout, joined here.
  // runAgentTurn awaits this before starting the next turn so memory writes
  // / audit writes / etc. land before the next retrieval. Self-clears on
  // settle (set to null inside runAfterTurn's .finally) so a timed-out
  // afterTurn doesn't poison every subsequent turn with a 10s wait.
  afterTurnPromise: Promise<void> | null;
  // Monotonic counter bumped by every control-plane action that cancels an
  // in-flight turn (abort, kill, replaceSession). runAgentTurn snapshots it
  // at entry — AFTER beginTurn flips state to thinking — and re-checks
  // after each await during plugin retrieval. Any change means a Stop or
  // session swap fired while plugin work was running, so the pre-send turn
  // bails with SessionSwappedError instead of sending the stale prompt
  // into the (possibly swapped) session. The pre-send window between
  // beginTurn and createTurnDeferred is the only place plain `pendingTurn`
  // rejection can't cover, because pendingTurn isn't installed yet — this
  // counter fills that gap.
  turnCancelToken: number;
  aborting: boolean;
  // Set while abort() is mid-flight (between session.close() and installSession of the
  // replacement). sendMessage awaits this so a follow-up message arriving in the gap
  // doesn't see session=null and amputate context by spinning up a fresh blank session.
  abortPromise: Promise<void> | null;
  slashCommands: { name: string; description?: string; aliasFor?: string; autoRun?: boolean }[];
  skills: SkillInfo[];
  sdkReportedCommands: string[]; // commands reported by SDK in system:init
  // Timing: track when phases start for duration_ms computation
  thinkingStartedAt: number;
  toolCallTimestamps: Map<string, number>; // toolUseId → start timestamp
  // Topic generation
  topicGenerating: boolean;
  topicMessageCount: number; // text entry count when topic was last generated
  // /resume two-step state
  pendingResume: boolean;
  pendingResumeSessions: { sessionId: string; lastModified: number; topic: string | null; topicMessageCount: number }[];
  // /model two-step state
  pendingModelPick: boolean;
  // /effort two-step state
  pendingEffortPick: boolean;
  // Auto-mode permission prompt two-step state
  pendingPermission: {
    approvalId: string;
    toolName: string;
  } | null;
  // Terminal PTY sidecar (spawned on demand via Node.js)
  ptySidecar: import("bun").Subprocess | null;
  ptyBuffer: string; // buffered output for reconnecting browsers
  // Pending messages queued while the agent was busy. Flushed together
  // as the agent transitions to an idle state. In-memory only.
  messageQueue: import("../../shared/types.ts").QueuedMessage[];
  flushInProgress: boolean;
  // Date.now() of each agent-initiated steer that actually interrupted a turn
  // of THIS receiver, newest last, pruned to the rate-limit window on each
  // check. Per receiver across all senders: what the limit protects is this
  // agent's ability to finish a turn, not any one sender's manners. Only real
  // interruptions are recorded — a steer at an idle receiver costs it nothing.
  // In-memory only; a restart starting a fresh window is correct (no turn
  // survives it to be interrupted). Human "Send now" is not counted or limited.
  recentSteers: number[];
  // /usage tracking. The SDK's `result` reports session-cumulative totals,
  // which are written to sessions.json on every turn (`usage` field) along
  // with a per-turn snapshot (`usageSnapshots`). /usage reads those entries
  // and aggregates per agent. Forked sessions subtract the parent's
  // cumulative-at-the-fork-point so shared turns aren't double-counted.
  lastWrittenEntryId: string | null;
  contextNudgesSent: Set<50 | 75>;
  pendingContextNotices: string[];
  // --- Subscription-allowance usage (the pill next to the context battery).
  // Latest committed reading for the ACCOUNT this agent's backend is signed in
  // to, or null/absent when there is none (Claude API-key/Bedrock/Vertex
  // sessions, Codex before any rate-limit payload, backend call failed).
  // Deliberately NOT tied to the conversation: quota is account-scoped, so
  // /clear, fork and same-engine resume leave it alone. In-memory only; lost on
  // server restart and repopulated on the next read. `...Account` is the engine
  // the reading was taken under, so an engine switch (a different provider
  // account) invalidates it; the two seqs keep a slow older sample from
  // overwriting a newer reading, in either direction. Optional so every
  // ManagedAgent construction site stays untouched — the commit protocol in
  // server/backends/subscription-usage.ts treats absent as "nothing yet".
  subscriptionUsage?: AgentSubscriptionUsage | null;
  subscriptionUsageAccount?: string | null;
  subscriptionSampleSeq?: number;
  subscriptionCommittedSeq?: number;
  // --- Truthful wake-up notice.
  // The wake-up line waiting to ride out on the next message, or null when the
  // wake had nothing to warn about (idle eviction, fresh session). Armed by the
  // two session-less wake paths (sendMessage's recovery branch, flushQueue's)
  // and by the boot restore, for a server restart or an unexpected backend
  // death; consumed by the pre-send step in runAgentTurn on a
  // never-before-send rule. Without it the warning reaches only the Bureau
  // log, and the agent — the one holding a tool result that falsely claims its
  // boss rejected the running command — never sees it.
  // No companion "fired" flag: every wake re-arms it, and there is nothing to
  // suppress across a conversation.
  //
  // DROPPED, never carried, at every conversation boundary (/clear, /resume,
  // handoff, new conversation). It describes a specific interrupted transcript,
  // so once the boundary moves the warning is about a transcript the agent is no
  // longer reading — and it says "just above". Clearing on send can't cover a
  // slot that was armed and then never consumed (send failed, then /clear),
  // which is exactly how a stale warning would ride into a fresh conversation.
  // Unconditional: at worst an agent loses a warning, which beats being handed
  // a false one.
  wakeNotice: string | null;
  // Why this agent's backend session is absent, when we know it. Only the
  // idle-session evictor takes a live, healthy session down on purpose, so
  // that's the one reason worth recording — a null here means "we did not do
  // this deliberately" and the wake paths warn accordingly. Cleared by
  // installSession, i.e. the moment the agent has a session again.
  dormantReason: "idle" | null;
}

export type AgentEvent =
  | { type: "agent_added"; agent: AgentInfo }
  | { type: "agent_removed"; agentId: string }
  | { type: "agent_updated"; agentId: string; changes: Partial<AgentInfo> }
  // Killed-agent chip lifecycle. Emitted by kill() and revive() in
  // lifecycle.ts. Routed through the onEvent handler in server/index.ts with
  // per-session ACL filtering on both variants: drop the event if the agent's
  // `lastRoomId` isn't in the session's visible set. Carrying lastRoomId on
  // both ends keeps the route filter symmetric and closes a minor info-leak
  // on the removed variant.
  | { type: "killed_agent_added"; agent: KilledAgentSummary }
  | { type: "killed_agent_removed"; agentId: string; lastRoomId: string }
  | { type: "log_entry"; entry: LogEntry }
  | { type: "room_created"; room: RoomWire }
  | { type: "room_closed"; roomId: string }
  | { type: "room_renamed"; roomId: string; name: string }
  | { type: "room_settings_updated"; roomId: string; prompt: string | null; envFile: string | null }
  | { type: "office_settings_updated"; prompt: string | null; envFile: string | null }
  | { type: "rooms_reordered"; order: string[] }
  | { type: "clear_logs"; agentId: string }
  | { type: "slash_commands"; agentId: string; commands: { name: string; description?: string; aliasFor?: string; autoRun?: boolean }[]; skills: SkillInfo[] }
  | { type: "terminal_output"; agentId: string; data: string }
  | { type: "terminal_exit"; agentId: string; exitCode: number };

export type EventHandler = (event: AgentEvent) => void;

// Internal room state: an ordered list of rooms, each with a stable id and its
// own settings. Agent membership is tracked on the agents map (agent.info.room
// is the index into this array — kept in sync for rendering).
export interface InternalRoom {
  id: string;
  name: string;
  prompt: string | null;
  envFile: string | null;
}
