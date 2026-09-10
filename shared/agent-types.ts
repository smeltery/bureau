import type { AgentCapabilities, AgentPermissionMode, CodexSandboxMode, EffortLevel } from "./agent-models.ts";
import type { Attachment } from "./log-types.ts";

// Agent states derived from SDK stream events
export type AgentState = "idle" | "thinking" | "tool_executing" | "waiting_for_response" | "error" | "stopped";

export type PendingPromptKind = "permission" | "resume" | "model" | "effort";

// Deterministic outfit from name hash
export interface AgentOutfit {
  hat: "none" | "cap" | "beanie" | "bow" | "headband";
  costume?: "none" | "doctor" | "police" | "firefighter" | "chef" | "construction" | "astronaut";
  color: string; // shirt color hex
  hair: string; // hair color hex
  hairStyle: "short" | "long" | "ponytail" | "bun" | "pigtails" | "curly" | "bald";
  skin: string; // skin color hex
  beard: "none" | "stubble" | "full" | "goatee" | "mustache";
  accessory: "glasses" | "headphones" | "bow_tie" | "tie" | "earrings" | null;
}

export type AgentBackendType = "claude" | "codex" | "opencode";

// Summary of a killed agent shown as a "revive" chip in the spawn menu.
// Carries only what the chip needs to render plus the id + lastRoomId for
// ACL filtering on the wire (cwd / customInstructions stay server-side and
// are loaded from agent-history at revive time). Sorted by killedAt desc in
// the UI; the server applies per-session ACL filtering before sending.
export interface KilledAgentSummary {
  id: string;
  name: string;
  agentType: AgentBackendType;
  lastRoomId: string;
  lastRoomName: string;
  topic: string | null;
  killedAt: number; // ms timestamp
}

export interface LogInFlightTurn {
  startedAt: number;
  activeTool: { name: string; startedAt: number } | null;
}

export interface ManifestInFlightTurn {
  startedAt: number;
  activeTool: { startedAt: number } | null;
}

// Max revive chips delivered to a session, applied AFTER ACL filtering so a
// session with restricted room access still sees up to this many visible
// chips. Imported by both server (cap) and UI (defensive re-slice).
export const KILLED_AGENT_CHIP_CAP = 12;

// What the browser knows about an agent
export interface AgentInfo {
  id: string;
  name: string;
  userId?: string | null;
  desk: number; // zero-based desk index
  room: number; // 0-based room index
  roomId?: string; // stable room id for clients that should not rely on projected room indexes
  cwd: string;
  outfit: AgentOutfit;
  permissionMode: AgentPermissionMode;
  modelFamily: string;
  agentType: AgentBackendType;
  capabilities: AgentCapabilities;
  privileged?: boolean;
  codexSandbox?: CodexSandboxMode;
  effort?: EffortLevel;
  state: AgentState;
  topic: string | null;
  topicStale: boolean;
  customInstructions: string | null;
  customInstructionsVersion?: string;
  pendingPrompt?: PendingPromptKind | null;
  // True while the agent's SDK session is being replaced (e.g. resume,
  // model change, edit/fork, slash-command compact). The chat UI shows a
  // "Restarting session..." hint until the swap completes — without it
  // there's no feedback during the drain → install gap, which can take
  // a noticeable beat on a busy session.
  sessionSwapping?: boolean;
  // True iff the current (or most-recent) turn started by processing a
  // human message. The UI gates the turn-end notification sound on this
  // so an agent-only turn (one agent messages another, the receiver
  // answers and idles) stays silent. In-memory only — never persisted.
  turnHadHumanInput?: boolean;
  inFlightTurn?: ManifestInFlightTurn | null;
  // Pending user messages that arrived while the agent was busy. Flushed
  // together as the agent transitions back to an idle state.
  queue?: QueuedMessage[];
  contextUsage?: AgentContextUsageSnapshot | null;
}

export interface AgentContextUsageSnapshot {
  model: string;
  totalTokens: number;
  maxTokens: number;
  percentage: number;
  sampledAtMs: number;
}

// One plan-allowance window (Claude's five_hour / seven_day / per-model
// windows, Codex's primary / secondary rate-limit windows). `usedPercent` is
// the backend's raw float (0..100) — round only for display, same rule as
// AgentContextUsageSnapshot.percentage.
export interface AgentSubscriptionWindow {
  // Display label already resolved server-side ("Weekly", "5-hour",
  // "Weekly (Opus)"), so the UI never has to know per-backend window names.
  label: string;
  usedPercent: number;
  resetsAtMs: number | null; // epoch ms, or null when the backend omits it
}

// How much of the BACKEND ACCOUNT's subscription allowance has been burned.
// Account-scoped, NOT conversation-scoped: every agent signed in to the same
// claude.ai account / CODEX_HOME reports the same figure, and it deliberately
// survives /clear, fork and resume (the quota doesn't reset when a
// conversation does). Null means there is nothing to show — an API key /
// Bedrock / Vertex Claude session, Codex before any rate-limit data has
// arrived, or a fresh server restart — and the pill renders its unknown state
// rather than disappearing.
export interface AgentSubscriptionUsage {
  // Backend-reported plan name ("max", "pro", "plus", ...), or null.
  plan: string | null;
  // At least one entry whenever this object exists, in a stable display order
  // (the plan-shaped window first). Every entry is a popover row.
  windows: AgentSubscriptionWindow[];
  // Index into `windows` of the one the PILL shows: whichever is closest to
  // its limit, picked server-side. Named explicitly rather than relying on
  // windows[0], because display order and "the binding window" are different
  // questions and the UI must not have to guess which it's being handed.
  primaryIndex: number;
  sampledAtMs: number;
}

// A pending message waiting for the agent to finish its current turn.
// Senders can be human bosses (typed at the textarea) or other agents
// (POST /api/agents/:id/messages); both go through the same queue and flush
// together. The receiver sees one chat bubble per item with the right
// kind of prefix so it can tell them apart.
// An app sender carries only the app's registered NAME: which app is speaking
// comes from the token it authenticated with, so there is no field a caller
// could lie in. Apps have no room and no id of their own — the receiving agent
// is the one that built the app.
export type QueuedSender =
  | { kind: "user"; username?: string; device?: string }
  | { kind: "agent"; agentId: string; agentName: string; roomName: string }
  | { kind: "app"; appName: string }
  | { kind: "cronjob"; cronjobId?: string; cronjobName: string };

export interface QueuedMessage {
  id: string; // short hex; UI uses this to cancel
  sender: QueuedSender;
  text: string; // what we show in chat (raw user input)
  clientMessageId?: string;
  // What we send to the SDK in place of `text`. Set when the queued item
  // is a pre-expanded slash command (e.g. /bureau-peer-review → full skill
  // prompt). Stays undefined for plain user messages.
  sdkText?: string;
  // True when the message landed while the agent was busy (thinking /
  // tool_executing) or otherwise unable to receive it immediately. Used
  // at flush time to warn the agent that the sender hadn't yet seen its
  // most recent reply when sending this.
  queuedDuringBusyTurn?: boolean;
  scheduledFor?: number;
  scheduledSenderGone?: boolean;
  // Set when this is a self-handoff brief injected by POST /api/agents/:id/handoff.
  handoff?: boolean;
  attachments?: Attachment[];
  queuedAt: number;
}

export interface ScheduledMessageEntry {
  id: string;
  senderAgentId: string;
  senderName: string;
  senderRoomName: string;
  receiverAgentId: string;
  text: string;
  clientMessageId?: string;
  deliverAt: number;
  createdAt: number;
}

export type MemoryScope = "office" | "room" | "agent" | "boss";

export interface MemoryItem {
  scope: MemoryScope;
  scopeId: string | null;
  author: string | null;
  date: string;
  text: string;
  raw: string;
}

// The size a memory scope contributes to an agent prompt: non-empty lines,
// newline-joined. Shared by server cap enforcement and settings editors.
export function injectedMemorySize(text: string): number {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .join("\n").length;
}

// Session info for resume feature
export interface SessionInfo {
  sessionId: string;
  lastModified: number;
  topic: string | null;
  // The cwd this session runs in. Source of truth is per-session metadata
  // (sessions.json); the agent's own cwd is just a denormalized mirror of the
  // active session's cwd. Optional/null for legacy sessions persisted before
  // per-session cwd existed — callers fall back to the agent cwd then.
  cwd?: string | null;
  branched?: boolean; // true if another session was forked from this one
  forked?: boolean; // true if this session is a fork (was created by editing a message)
}

// Skill metadata for autocomplete and /help
export type SkillOrigin = "user" | "project" | "plugin" | "bureau" | "claude";
export interface SkillInfo {
  name: string;
  origin: SkillOrigin;
  description?: string;
  /**
   * Marks this entry as an alias of another skill. The other skill is the
   * canonical name (typically the on-disk directory name); this one is a
   * friendlier alias declared via SKILL.md frontmatter. /help groups
   * canonicals + aliases so the user sees a single line per skill.
   */
  aliasFor?: string;
}
