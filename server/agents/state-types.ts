import type { AgentInfo, AgentSubscriptionUsage, ExperimentalSettings, KilledAgentSummary, LogEntry, RoomPet, RoomWire, SkillInfo, SlideFailureReason, SlideRecord } from "../../shared/types.ts";
import type { BackendSession, NormalizedEvent } from "../backends/types.ts";

// Internal agent state
export interface ManagedAgent {
  info: AgentInfo;
  session: BackendSession | null;
  /** Suspend automatic queue retries only for the session known to need login. */
  providerSignInBlockedSession?: BackendSession;
  sessionId: string | null;
  lastActivityAt: number;
  // Persistent consumer loop iterating `session.stream()` for the session's
  // lifetime. See docs/investigations/held-back-messages-investigation.md — without this,
  // task_notifications buffered between turns get flushed one turn late.
  consumerPromise: Promise<void> | null;
  // Per-turn deferred. sendMessage/executeSkill await this; the consumer
  // resolves it when the turn's `stream()` iterator ends at `result`.
  //
  // `anchorEntryId` is the `user_message` entry id anchoring this in-flight turn
  // (the newest deck turn), or null when the turn has no anchor at all. Slide
  // Mode reads it to gate slide generation: a turn is "terminal" once it is no
  // longer this anchor (pendingTurn cleared, or superseded by a newer turn).
  // Filled from two directions, because the anchor is logged on either side of
  // the deferred depending on the path: createTurnDeferred CLAIMS
  // nextTurnAnchorEntryId (every path that logs the user_message before the
  // send), and addLogEntry stamps it directly when the message is logged while
  // the turn already runs (the queued flush, which logs from onSendAccepted).
  // Goes away when pendingTurn is nulled at turn_completed.
  pendingTurn: { promise: Promise<void>; resolve: () => void; reject: (err: unknown) => void; anchorEntryId: string | null } | null;
  // The `user_message` entry id logged for a turn whose deferred is not
  // installed yet — sendMessage / executeSkill / editMessage all log the anchor
  // and only then reach runAgentTurn. createTurnDeferred claims it (and clears
  // it, so it is claimed at most once) as the turn's anchorEntryId. Without this
  // the direct-send paths would run with a null anchor, every turn would read
  // TERMINAL while it was still streaming, and Slide Mode would write an
  // empty-turn placeholder over the live turn.
  nextTurnAnchorEntryId: string | null;
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
  turnStartedAt: number;
  lastNormalizedEventAt: number;
  busyTurnWatchdogObserved: boolean;
  toolCallTimestamps: Map<string, { name: string; startedAt: number }>; // toolUseId → start metadata
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
  // /bureau-cronjob-system-prompt two-step state
  pendingCronjobPick: boolean;
  // Auto-mode permission prompt two-step state. Carries the approvalId for
  // routing plus enough to interpret the reply; the backend holds the
  // SDK-side resolver and the rules themselves, applied when session.approve()
  // is called with "allow_persistent" or "allow_prefix".
  pendingPermission: {
    approvalId: string;
    toolName: string;
    // Human-readable form of the broader session rule the backend offered as
    // option 4, when it offered one. Display + gate only: the rule itself
    // stays inside the backend, which applies it on an "allow_prefix"
    // decision. Undefined means no 4th option was shown, and a "4" reply is
    // treated as any other unrecognized text (deny with that as the reason).
    allowPrefixLabel?: string;
  } | null;
  queuedPermissions: {
    event: Extract<NormalizedEvent, { kind: "approval_request" }>;
    session: BackendSession | null;
  }[];
  // Terminal PTY sidecar (spawned on demand via Node.js)
  ptySidecar: import("bun").Subprocess | null;
  ptyBuffer: string; // buffered output for reconnecting browsers
  // Pending messages queued while the agent was busy. Flushed together
  // as the agent transitions to an idle state. In-memory only.
  messageQueue: import("../../shared/types.ts").QueuedMessage[];
  // clientMessageId → expiry + original message id. Makes POST /message
  // retries safe for a short window after delivery (and while still queued).
  // Persisted expiry survives restarts; messageId is live-ack only.
  queueDedupe: Map<string, { expiresAt: number; messageId: string }>;
  // Set synchronously when an inbound message claims recovery of an errored
  // backend. Later messages join the same durable queue instead of starting a
  // second resume against the same transcript.
  autoResumeInProgress: boolean;
  flushInProgress: boolean;
  // Set while a handoff swaps sessions, so queued messages wait for the brief
  // instead of reaching the fresh session ahead of it.
  flushHeld: boolean;
  // Date.now() of each agent-initiated steer that actually interrupted a turn
  // of THIS receiver, newest last, pruned to the rate-limit window on each
  // check. Per receiver across all senders: what the limit protects is this
  // agent's ability to finish a turn, not any one sender's manners. Only real
  // interruptions are recorded — a steer at an idle receiver costs it nothing.
  // In-memory only; a restart starting a fresh window is correct (no turn
  // survives it to be interrupted). Human "Send now" is not counted or limited.
  recentSteers: number[];
  boundaryClaim: { session: BackendSession | null; items: Set<import("../../shared/types.ts").QueuedMessage> } | null;
  // /usage tracking. The SDK's `result` reports session-cumulative totals,
  // which are written to sessions.json on every turn (`usage` field) along
  // with a per-turn snapshot (`usageSnapshots`). /usage reads those entries
  // and aggregates per agent. Forked sessions subtract the parent's
  // cumulative-at-the-fork-point so shared turns aren't double-counted.
  lastWrittenEntryId: string | null;
  contextNudgesSent: Set<50 | 75>;
  // Boss-facing ephemeral context wrap-up notices (separate audience from
  // contextNudgesSent). Reset at conversation boundaries with the agent set.
  firedUiThresholds: Set<50 | 75>;
  pendingContextNotices: string[];
  memoryNotice: string | null;
  memoryNoticeFired: boolean;
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
  // Effective CLAUDE_CONFIG_DIR used by the currently launched Claude process.
  // Stamped into session metadata when system_init reports the session id.
  launchedClaudeConfigDir?: string;
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
  | { type: "room_pet_updated"; roomId: string; pet: RoomPet | null }
  | { type: "room_skin_updated"; roomId: string; skin: import("../../shared/types.ts").RoomSkin | null }
  | { type: "room_decor_updated"; roomId: string; decor: import("../../shared/types.ts").RoomDecor | null }
  | { type: "office_settings_updated"; prompt: string | null; envFile: string | null; experimental?: ExperimentalSettings; receptionistAgentId?: string | null }
  | { type: "rooms_reordered"; order: string[] }
  | { type: "clear_logs"; agentId: string }
  | { type: "slash_commands"; agentId: string; commands: { name: string; description?: string; aliasFor?: string; autoRun?: boolean }[]; skills: SkillInfo[] }
  // Slide Mode outcomes for one turn. Routed like log_entry (per-session room
  // ACL) in server/ws/agent-events.ts — anyone who can see the chat can see its
  // slides. `slide_failed` is the client's only "stop waiting" signal.
  | { type: "slide_ready"; agentId: string; sessionId: string; entryId: string; slide: SlideRecord }
  | { type: "slide_failed"; agentId: string; sessionId: string; entryId: string; reason: SlideFailureReason }
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
  pet?: RoomPet | null;
  skin?: import("../../shared/types.ts").RoomSkin | null;
  decor?: import("../../shared/types.ts").RoomDecor | null;
}
