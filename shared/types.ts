import type { GhostVariant } from "./avatar.ts";

// Agent states derived from SDK stream events
export type AgentState = "idle" | "thinking" | "tool_executing" | "waiting_for_response" | "error" | "stopped";

// Deterministic outfit from name hash
export interface AgentOutfit {
  hat: "none" | "cap" | "beanie" | "bow" | "headband";
  color: string; // shirt color hex
  hair: string; // hair color hex
  hairStyle: "short" | "long" | "ponytail" | "bun" | "pigtails" | "curly" | "bald";
  skin: string; // skin color hex
  beard: "none" | "stubble" | "full" | "goatee" | "mustache";
  accessory: "glasses" | "headphones" | "bow_tie" | "tie" | "earrings" | null;
}

export type AgentBackendType = "claude" | "codex";

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

// Max revive chips delivered to a session, applied AFTER ACL filtering so a
// session with restricted room access still sees up to this many visible
// chips. Imported by both server (cap) and UI (defensive re-slice).
export const KILLED_AGENT_CHIP_CAP = 12;

export type ClaudePermissionMode = "default" | "acceptEdits" | "bypassPermissions" | "auto";
export type CodexApprovalPolicy = "untrusted" | "on-request" | "on-failure" | "never";
export type CodexSandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type AgentPermissionMode = ClaudePermissionMode | CodexApprovalPolicy;

export interface AgentCapabilities {
  fork: boolean;
  hooks: boolean;
  skills: boolean;
  oneShot: boolean;
  canUseTool: boolean;
  topicGen: boolean;
  edit: boolean;
  mcp: boolean;
}

export const DEFAULT_AGENT_CAPABILITIES: AgentCapabilities = {
  fork: true,
  hooks: true,
  skills: true,
  oneShot: true,
  canUseTool: true,
  topicGen: true,
  edit: true,
  mcp: true,
};

// Model families — what users pick ("I want Opus"). Exact versions are an
// implementation detail that the system bumps centrally in FAMILY_TO_MODEL.
export type ModelFamily = "opus" | "sonnet" | "haiku" | "fable";

export type ClaudeModel = string;

export const FAMILY_TO_MODEL: Record<ModelFamily, ClaudeModel> = {
  opus: "claude-opus-4-8",
  sonnet: "claude-sonnet-4-6",
  haiku: "claude-haiku-4-5-20251001",
  fable: "claude-fable-5",
};

export const MODEL_FAMILIES: { family: ModelFamily; label: string }[] = [
  { family: "opus", label: "Opus" },
  { family: "sonnet", label: "Sonnet" },
  { family: "haiku", label: "Haiku" },
  { family: "fable", label: "Fable" },
];

// Extract "4.8" from "claude-opus-4-8" for display. Single-number slugs like
// "claude-fable-5" have no minor segment, so fall back to the trailing number.
export function modelVersionLabel(family: ModelFamily): string {
  const exact = FAMILY_TO_MODEL[family];
  const twoPart = exact.match(/-(\d+)-(\d+)/);
  if (twoPart) return `${twoPart[1]}.${twoPart[2]}`;
  const onePart = exact.match(/-(\d+)$/);
  return onePart ? onePart[1] : exact;
}

export type EffortLevel = "minimal" | "low" | "medium" | "high" | "xhigh" | "max";

export const EFFORT_LEVELS: { level: EffortLevel; label: string }[] = [
  { level: "minimal", label: "Minimal (Codex only)" },
  { level: "low", label: "Low" },
  { level: "medium", label: "Medium" },
  { level: "high", label: "High" },
  { level: "xhigh", label: "Extra high" },
  { level: "max", label: "Max (Opus/Fable only)" },
];

export const DEFAULT_EFFORT: EffortLevel = "xhigh";

export function effortDisplayLabel(level: EffortLevel | undefined): string {
  const resolved = level ?? DEFAULT_EFFORT;
  return EFFORT_LEVELS.find((e) => e.level === resolved)?.label ?? resolved;
}

export const CODEX_MODELS: { value: string; label: string }[] = [
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 mini" },
  { value: "gpt-5.3-codex", label: "GPT-5.3 Codex" },
  { value: "gpt-5.2", label: "GPT-5.2" },
];

export function isClaudeFamily(s: string): s is ModelFamily {
  return s === "opus" || s === "sonnet" || s === "haiku" || s === "fable";
}

// The classifier-backed "auto" permission mode is only offered for the
// higher-capability families that drive the safe-action classifier well.
export function familyAllowsAutoPermission(family: string | undefined): boolean {
  return family === "opus" || family === "fable";
}

export function familyDisplayLabel(family: string): string {
  if (!isClaudeFamily(family)) {
    return CODEX_MODELS.find((m) => m.value === family)?.label ?? family;
  }
  const base = MODEL_FAMILIES.find((m) => m.family === family)?.label ?? family;
  return `${base} ${modelVersionLabel(family)}`;
}

// Migrate a legacy exact model ID (e.g. "claude-opus-4-6") to a family.
export function familyFromLegacyModel(model: string | undefined): ModelFamily {
  if (!model) return "opus";
  if (model.includes("opus")) return "opus";
  if (model.includes("sonnet")) return "sonnet";
  if (model.includes("haiku")) return "haiku";
  if (model.includes("fable")) return "fable";
  return "opus";
}

// What the browser knows about an agent
export interface AgentInfo {
  id: string;
  name: string;
  userId?: string | null;
  desk: number; // 0-7
  room: number; // 0-based room index
  cwd: string;
  outfit: AgentOutfit;
  permissionMode: AgentPermissionMode;
  modelFamily: string;
  agentType: AgentBackendType;
  capabilities: AgentCapabilities;
  codexSandbox?: CodexSandboxMode;
  effort?: EffortLevel;
  state: AgentState;
  topic: string | null;
  topicStale: boolean;
  customInstructions: string | null;
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
  // Pending user messages that arrived while the agent was busy. Flushed
  // together as the agent transitions back to an idle state. In-memory
  // only — never persisted.
  queue?: QueuedMessage[];
}

// A pending message waiting for the agent to finish its current turn.
// Senders can be human bosses (typed at the textarea) or other agents
// (POST /agents/:id/message); both go through the same queue and flush
// together. The receiver sees one chat bubble per item with the right
// kind of prefix so it can tell them apart.
export type QueuedSender = { kind: "user"; username?: string } | { kind: "agent"; agentId: string; agentName: string; roomName: string };

export interface QueuedMessage {
  id: string; // short hex; UI uses this to cancel
  sender: QueuedSender;
  text: string; // what we show in chat (raw user input)
  // What we send to the SDK in place of `text`. Set when the queued item
  // is a pre-expanded slash command (e.g. /bureau-peer-review → full skill
  // prompt). Stays undefined for plain user messages.
  sdkText?: string;
  // True when the message landed while the agent was busy (thinking /
  // tool_executing) or otherwise unable to receive it immediately. Used
  // at flush time to warn the agent that the sender hadn't yet seen its
  // most recent reply when sending this.
  queuedDuringBusyTurn?: boolean;
  attachments?: Attachment[];
  queuedAt: number;
}

// File attachment metadata
export interface Attachment {
  filename: string; // on-disk hash name: "a1b2c3.png"
  originalName: string; // user-facing: "photo.png"
  mediaType: string; // "image/png", "application/pdf", etc.
  size: number; // bytes
}

// Per-file summary inside a kind:"diff" LogEntry. The server pre-computes
// inlineEligible so the client doesn't re-parse the patch to decide rendering.
export interface DiffFileSummary {
  path: string;
  oldPath?: string; // set on rename / copy
  status: "added" | "modified" | "deleted" | "renamed" | "copied" | "untracked" | "binary";
  additions: number;
  deletions: number;
  lineCount: number; // approx size of the per-file patch (additions + deletions)
  inlineEligible: boolean; // server-computed: lineCount <= 500 && !binary && patch present
}

// Structured payload attached to LogEntry when kind === "diff".
export interface DiffPayload {
  cwd: string;
  branch: string | null; // null on detached HEAD or fresh repo
  head: string | null; // short SHA, null on fresh repo with no commits
  // Present when the diff targets a specific commit/range rather than the
  // working tree. Single commits use the commit subject; ranges use the
  // literal range string. Optional for persisted pre-existing diff entries.
  subject?: string | null;
  stats: { additions: number; deletions: number; filesChanged: number };
  files: DiffFileSummary[];
  patchText: string | null; // null when over 2MB safety rail
  truncated: boolean; // true when patchText was dropped
}

// Structured payload attached to LogEntry when kind === "edit-request".
// Emitted by POST /agents/:id/edit-file. The card surfaces an
// [Open in editor] button that opens the file in the editor side panel.
export interface FilePayload {
  path: string; // resolved absolute path
}

// Structured payload attached to LogEntry when kind === "terminal-command".
// Emitted by POST /agents/:id/terminal-command. The card surfaces a
// [Copy to terminal] button that opens the terminal side panel and types
// the command at the prompt without executing it (boss presses Enter).
export interface TerminalCommandPayload {
  command: string; // single-line shell command
}

// Log entry in the conversation view
export interface LogEntry {
  id: string;
  agentId: string;
  timestamp: number;
  kind: "text" | "thinking" | "tool_call" | "tool_result" | "error" | "system" | "user_message" | "diff" | "edit-request" | "terminal-command" | "file-view";
  content: string;
  metadata?: Record<string, unknown>;
  attachments?: Attachment[]; // file attachments, served via /api/files/<agentId>/<filename>
  diff?: DiffPayload; // present only when kind === "diff"
  file?: FilePayload; // present only when kind === "edit-request"
  terminal?: TerminalCommandPayload; // present only when kind === "terminal-command"
}

// Task item (replaces todos)
export type TaskStatus = "open" | "in_progress" | "done" | "backlog";
export type TaskPriority = "P0" | "P1" | "P2" | "P3";

export interface TaskItem {
  id: string; // 8-char hex hash
  title: string;
  description?: string;
  priority?: TaskPriority;
  status: TaskStatus;
  assignee?: string;
  createdBy: string;
  createdAt: number;
}

export type MemoryScope = "office" | "room" | "agent" | "boss";

export interface MemoryItem {
  scope: MemoryScope;
  scopeId: string | null;
  author: string;
  date: string;
  text: string;
  raw: string;
}

// Generate a unique 8-char hex ID, avoiding collisions with `existing`.
function generateHexId(existing?: string[]): string {
  const ids = existing ? new Set(existing) : undefined;
  for (;;) {
    const bytes = new Uint8Array(4);
    crypto.getRandomValues(bytes);
    const id = Array.from(bytes)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    if (!ids || !ids.has(id)) return id;
  }
}

export function generateTaskId(existing?: string[]): string {
  return generateHexId(existing);
}

export function generateCronjobId(existing?: string[]): string {
  return generateHexId(existing);
}

export function generateCronjobRunId(existing?: string[]): string {
  return generateHexId(existing);
}

// ---------------------------------------------------------------------------
// Cronjobs
// ---------------------------------------------------------------------------
// Cronjobs are scheduled backend sessions. They are NOT agents — no desk, no
// room, no persistent identity. Each scheduled fire creates a fresh session
// whose transcript becomes a "run" row.

export type Schedule = { type: "daily"; hour: number; minute: number } | { type: "weekly"; weekday: 0 | 1 | 2 | 3 | 4 | 5 | 6; hour: number; minute: number } | { type: "interval"; minutes: number };

// Permission modes available for cronjobs. Modes that can block on human
// approval would hang forever in an unattended run.
export type CronjobPermissionMode = "bypassPermissions" | "never";

export interface Cronjob {
  id: string; // 8-char hex
  name: string; // free text, not unique
  schedule: Schedule;
  prompt: string; // first user message at each fire
  cwd: string;
  agentType: AgentBackendType;
  modelFamily: ModelFamily;
  permissionMode: CronjobPermissionMode;
  enabled: boolean;
  createdBy: string;
  device: string | null;
  createdAt: number;
  lastFireAt: number | null;
  nextFireAt: number;
}

export type CronjobRunStatus = "running" | "completed" | "failed" | "timed_out" | "skipped";
export type CronjobRunTrigger = "scheduled" | "manual";

export interface CronjobRun {
  id: string; // 8-char hex
  cronjobId: string;
  cronjobName: string; // denormalized so deleted-cronjob runs still display
  trigger: CronjobRunTrigger;
  status: CronjobRunStatus;
  startedAt: number;
  endedAt: number | null;
  errorReason: string | null;
  promptSnapshot: string;
  agentTypeSnapshot: AgentBackendType;
  modelFamilySnapshot: ModelFamily;
  cwdSnapshot: string;
  permissionModeSnapshot: CronjobPermissionMode;
  rootSessionId: string; // first session id created at fire time
  // Leaf of the fork chain — equals rootSessionId for un-forked runs. Tracked
  // separately from rootSessionId so loadRunLogWithAncestors can walk back from
  // the leaf when the user has edited a message and forked. Optional for
  // backwards compatibility with runs persisted before resume support landed.
  currentSessionId?: string;
  previewText: string; // last assistant text block, truncated ~120 chars
}

// Cronjob runs piggy-back on the LogEntry.agentId routing by using a
// "cronrun-<runId>" prefix as a synthetic stream id. Entries written for a run
// carry this in `agentId` so the existing client-side Map<streamId, entries>
// routing works unchanged.
export function cronjobRunStreamId(runId: string): string {
  return `cronrun-${runId}`;
}

export function parseStreamId(id: string): { kind: "agent"; agentId: string } | { kind: "cronjob_run"; runId: string } {
  if (id.startsWith("cronrun-")) return { kind: "cronjob_run", runId: id.slice("cronrun-".length) };
  return { kind: "agent", agentId: id };
}

export function humanizeSchedule(s: Schedule): string {
  const pad = (n: number) => n.toString().padStart(2, "0");
  if (s.type === "daily") return `Daily at ${pad(s.hour)}:${pad(s.minute)}`;
  if (s.type === "weekly") {
    const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return `Weekly ${weekdays[s.weekday]} at ${pad(s.hour)}:${pad(s.minute)}`;
  }
  if (s.minutes < 60) return `Every ${s.minutes}m`;
  if (s.minutes % 60 === 0) return `Every ${s.minutes / 60}h`;
  return `Every ${Math.floor(s.minutes / 60)}h${s.minutes % 60}m`;
}

// ---------------------------------------------------------------------------
// Claude Code plugin management — the CLI's plugin ecosystem (skills, hooks,
// MCP servers installed via `claude plugin`), NOT bureau's in-process plugins
// (those live in shared/plugin-types.ts). Managed by shelling out to the
// headless CLI; see server/plugins/cc-plugins.ts.
// ---------------------------------------------------------------------------

export type CCPluginScope = "user" | "project" | "local" | "managed";

export interface CCInstalledPlugin {
  id: string; // "name@marketplace"
  name: string;
  marketplace: string;
  version: string;
  scope: CCPluginScope;
  /** Effective state: enabledPlugins[id] !== false in ~/.claude/settings.json.
   *  An absent entry means enabled-by-default, which the CLI's own `list`
   *  reports as false — we report what actually happens at session spawn. */
  enabled: boolean;
  description?: string;
  installedAt?: string; // ISO 8601
  lastUpdated?: string; // ISO 8601
}

export interface CCAvailablePlugin {
  id: string; // "name@marketplace"
  name: string;
  marketplace: string;
  description?: string;
  version?: string;
  installCount?: number;
  installed: boolean;
}

export interface CCMarketplace {
  name: string;
  source: string; // "github" | "url" | local path kinds
  repo?: string; // owner/repo when source === "github"
  url?: string;
}

export interface CCPluginsState {
  installed: CCInstalledPlugin[];
  available: CCAvailablePlugin[];
  marketplaces: CCMarketplace[];
  fetchedAt: number; // ms epoch of the CLI read backing this snapshot
}

const VALID_STATUSES = new Set<TaskStatus>(["open", "in_progress", "done", "backlog"]);
const VALID_PRIORITIES = new Set<TaskPriority>(["P0", "P1", "P2", "P3"]);

export function isValidStatus(s: unknown): s is TaskStatus {
  return typeof s === "string" && VALID_STATUSES.has(s as TaskStatus);
}

export function isValidPriority(p: unknown): p is TaskPriority {
  return typeof p === "string" && VALID_PRIORITIES.has(p as TaskPriority);
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

// Office-level settings (prompt + optional env file path)
export interface OfficeSettings {
  prompt: string | null;
  envFile: string | null;
}

export type UserRole = "owner" | "member";

export interface UserRecord {
  id: string;
  name: string;
  role: UserRole;
  // Strict list of room IDs this user can see and act in. Owners can edit it.
  allowedRooms: string[];
  defaultRoomId: string | null;
  // Rooms this user gets notification sounds / desktop alerts for. Strict
  // string[] of roomIds — no "all" sentinel. New users get a snapshot of
  // their allowed rooms (notify everywhere by default); they can pare it
  // down in User Settings. See shouldNotifyRoom in shared/notifications.ts.
  notifRooms: string[];
  avatarColor: string;
  avatarVariant: GhostVariant;
  createdAt: number;
}

export interface SessionContext {
  userId: string;
  username: string;
  role: UserRole;
  currentSessionPrefix: string;
  connectionId: string;
}

export interface PresenceInfo {
  connectionId: string;
  userId: string;
  username: string;
  device: string | null;
  avatarColor: string;
  avatarVariant: GhostVariant;
  currentRoom: number | null;
  focusedAgentId: string | null;
  viewMode: "office" | "log" | "away";
}

export interface SessionWire {
  sessionPrefix: string;
  username: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  absoluteExpiresAt: number;
  userAgent?: string | null;
}

// Wire shape for an outstanding invite (owner UI). Raw token never crosses
// the wire — only the 8-char display prefix.
export interface InviteWire {
  tokenPrefix: string;
  username: string | null; // null for unconsumed bootstrap invites
  role: UserRole;
  createdBy: string | null; // null for bootstrap (no owner existed yet)
  createdAt: number;
  expiresAt: number;
  bootstrap?: true; // present on bootstrap invites so the UI can label them
}

// A room with stable ID, display name, and per-room config
export interface RoomWire {
  id: string; // 8-char hex, stable
  name: string; // display name
  prompt: string | null;
  envFile: string | null;
}

// Response to update_*_settings (sent only to the requesting client)
export interface SettingsSaveResponse {
  type: "settings_save_response";
  requestId: string;
  ok: boolean;
  error?: string;
}

// Response to request_settings_validation (sent only to the requesting client)
export interface SettingsValidationResponse {
  type: "settings_validation";
  requestId: string;
  scope: "office" | "room";
  roomId?: string;
  envFile: string | null;
  ok: boolean;
  keyCount?: number;
  error?: string;
}

// Response to spawn / edit_agent (sent only to the requesting client, when requestId provided)
export interface AgentSaveResponse {
  type: "agent_save_response";
  requestId: string;
  ok: boolean;
  error?: string;
}

// Response to request_cwd_validation (sent only to the requesting client)
export interface CwdValidationResponse {
  type: "cwd_validation";
  requestId: string;
  ok: boolean;
  error?: string;
}

// Server → Browser messages
export type ServerMessage =
  | { type: "full_state"; agents: AgentInfo[]; recentCwds: string[]; office: OfficeSettings; rooms: RoomWire[]; allRooms?: RoomWire[]; killedAgents: KilledAgentSummary[] }
  | { type: "session_context"; context: SessionContext | null }
  | { type: "presence_list"; entries: PresenceInfo[]; totalOnlineUsers: number }
  | { type: "users_list"; users: UserRecord[] }
  | { type: "sessions_active_list"; sessions: SessionWire[] }
  | { type: "invites_list"; invites: InviteWire[] }
  | {
      type: "invite_minted";
      requestId: string;
      ok: boolean;
      url?: string;
      invite?: InviteWire;
      error?: string;
    }
  | { type: "invite_revoked"; tokenPrefix: string }
  | { type: "session_revoked"; sessionPrefix: string }
  | { type: "revoke_blocked"; sessionPrefix: string; reason: string }
  | { type: "session_expired" }
  | {
      type: "access_settings";
      ok: boolean;
      externalAccess?: boolean;
      publicOrigin?: string | null;
      envOriginSet?: boolean;
      envOrigin?: string | null;
      boundLoopback?: boolean;
      officeName?: string | null;
      error?: string;
    }
  | {
      type: "access_settings_updated";
      requestId: string;
      ok: boolean;
      externalAccess?: boolean;
      publicOrigin?: string | null;
      signInUrl?: string | null;
      restartRequired?: boolean;
      envOrigin?: string | null;
      officeName?: string | null;
      error?: string;
    }
  | { type: "agent_added"; agent: AgentInfo }
  | { type: "agent_removed"; agentId: string }
  | { type: "agent_updated"; agentId: string; changes: Partial<AgentInfo> }
  // Killed-agent chip lifecycle. ACL-filtered server-side: both variants are
  // delivered only to sessions whose visible rooms include the agent's
  // `lastRoomId` (the room it was killed in, captured in the history
  // snapshot). Carrying `lastRoomId` on the removed variant closes a tiny
  // info-leak: an unfiltered removed-event would tell a session a hidden
  // killed-agent id became alive again, even though it never saw the add.
  | { type: "killed_agent_added"; agent: KilledAgentSummary }
  | { type: "killed_agent_removed"; agentId: string; lastRoomId: string }
  | { type: "log_entry"; entry: LogEntry }
  | { type: "sessions_list"; agentId: string; sessions: SessionInfo[]; currentSessionId: string | null }
  | { type: "slash_commands"; agentId: string; commands: { name: string; description?: string; aliasFor?: string }[]; skills: SkillInfo[] }
  | { type: "clear_logs"; agentId: string }
  | { type: "terminal_output"; agentId: string; data: string }
  | { type: "terminal_exit"; agentId: string; exitCode: number }
  | { type: "editor_content"; agentId: string; path: string; content: string; mtime: number; language: string; size: number }
  | { type: "editor_save_response"; agentId: string; path: string; ok: boolean; mtime?: number; error?: string; reason?: "stale"; currentMtime?: number }
  | { type: "editor_external_change"; agentId: string; path: string; mtime: number }
  | { type: "editor_open_error"; agentId: string; path: string; reason: "not_found" | "not_file" | "binary" | "too_large" | "io_error" | "bad_path"; message?: string; size?: number }
  | { type: "office_settings_updated"; prompt: string | null; envFile: string | null }
  | { type: "tasks"; tasks: TaskItem[] }
  | { type: "room_created"; room: RoomWire }
  | { type: "room_closed"; roomId: string }
  | { type: "room_renamed"; roomId: string; name: string }
  | { type: "room_settings_updated"; roomId: string; prompt: string | null; envFile: string | null }
  | { type: "rooms_reordered"; order: string[] }
  | SettingsSaveResponse
  | SettingsValidationResponse
  | AgentSaveResponse
  | CwdValidationResponse
  | { type: "update_status"; updateAvailable: boolean; current: { sha: string; message: string; date: string }; latest: { sha: string; message: string; date: string } }
  | { type: "cronjobs_state"; cronjobs: Cronjob[]; cronjobsPrompt: string | null }
  | { type: "cronjob_added"; cronjob: Cronjob }
  | { type: "cronjob_updated"; cronjob: Cronjob }
  | { type: "cronjob_deleted"; id: string }
  | { type: "cronjobs_prompt_updated"; value: string | null }
  | { type: "cronjob_runs"; cronjobId: string; runs: CronjobRun[] }
  | { type: "cronjob_runs_complete" }
  | { type: "cronjob_run_updated"; run: CronjobRun }
  | { type: "cc_plugins_state"; plugins: CCPluginsState }
  | { type: "pong" };

// Browser → Server commands
export type ClientCommand =
  | {
      type: "spawn";
      requestId?: string;
      name: string;
      cwd: string;
      permissionMode: AgentInfo["permissionMode"];
      desk: number;
      roomId?: string;
      customInstructions?: string;
      outfit?: AgentOutfit;
      modelFamily?: string;
      agentType?: AgentBackendType;
      codexSandbox?: CodexSandboxMode;
      effort?: EffortLevel;
    }
  | { type: "kill"; agentId: string }
  | {
      // Revive a killed agent. Restores its config from agent-history
      // (cwd / outfit / model / etc.) at the target desk in the caller's
      // current room. Same id as the original — log history and any
      // resumable lastSessionId continue from where they left off.
      type: "revive";
      requestId?: string;
      agentId: string;
      desk: number;
      roomId: string;
    }
  | { type: "abort"; agentId: string }
  | { type: "send_message"; agentId: string; text: string; username?: string; attachments?: Attachment[] }
  | { type: "new_conversation"; agentId: string }
  | { type: "resume"; agentId: string; sessionId: string }
  | { type: "list_sessions"; agentId: string }
  | {
      type: "edit_agent";
      requestId?: string;
      agentId: string;
      name?: string;
      cwd?: string;
      outfit?: AgentOutfit;
      customInstructions?: string;
      modelFamily?: string;
      permissionMode?: AgentInfo["permissionMode"];
      codexSandbox?: CodexSandboxMode;
      effort?: EffortLevel;
    }
  | { type: "swap_desks"; deskA: number; deskB: number; roomId: string }
  | { type: "set_topic"; agentId: string; topic: string }
  | { type: "reset_topic"; agentId: string }
  | { type: "terminal_open"; agentId: string }
  | { type: "terminal_input"; agentId: string; data: string }
  | { type: "terminal_resize"; agentId: string; cols: number; rows: number }
  | { type: "terminal_close"; agentId: string }
  | { type: "editor_open"; agentId: string; path: string }
  | { type: "editor_save"; agentId: string; path: string; content: string; expectedMtime: number; force?: boolean }
  | { type: "editor_close"; agentId: string; path: string }
  | { type: "update_office_settings"; requestId: string; prompt: string | null; envFile: string | null }
  | { type: "update_room_settings"; requestId: string; roomId: string; prompt: string | null; envFile: string | null }
  | { type: "request_settings_validation"; requestId: string; scope: "office" | "room"; roomId?: string }
  | { type: "request_cwd_validation"; requestId: string; cwd: string }
  | { type: "add_task"; title: string; description?: string; priority?: TaskPriority; assignee?: string; username: string }
  | { type: "update_task"; id: string; changes: Partial<Pick<TaskItem, "title" | "description" | "priority" | "status" | "assignee">> }
  | { type: "delete_task"; id: string }
  | { type: "create_room"; name?: string }
  | { type: "close_room"; roomId: string }
  | { type: "rename_room"; roomId: string; name: string }
  | { type: "move_agent"; agentId: string; targetRoomId: string }
  | { type: "reorder_rooms"; order: string[] }
  | { type: "edit_message"; agentId: string; logEntryId: string; newText: string; username?: string }
  | { type: "dequeue_message"; agentId: string; queuedId: string }
  | {
      type: "add_cronjob";
      requestId?: string;
      name: string;
      schedule: Schedule;
      prompt: string;
      cwd: string;
      modelFamily: ModelFamily;
      permissionMode: CronjobPermissionMode;
      username: string;
      device?: string;
    }
  | { type: "update_cronjob"; requestId?: string; id: string; changes: Partial<Pick<Cronjob, "name" | "schedule" | "prompt" | "cwd" | "modelFamily" | "permissionMode" | "enabled">> }
  | { type: "delete_cronjob"; id: string }
  | { type: "run_cronjob_now"; id: string; username: string; device?: string }
  | { type: "update_cronjobs_prompt"; requestId: string; value: string | null }
  | { type: "list_cronjob_runs"; cronjobId: string }
  | { type: "list_all_cronjob_runs" }
  | { type: "load_cronjob_run"; cronjobId: string; runId: string }
  | { type: "send_cronjob_run_message"; cronjobId: string; runId: string; text: string; username?: string }
  | { type: "edit_cronjob_run_message"; cronjobId: string; runId: string; logEntryId: string; newText: string; username?: string }
  | { type: "claim_user"; username: string }
  | { type: "update_user"; userId: string; changes: Partial<Pick<UserRecord, "name" | "role" | "allowedRooms" | "defaultRoomId" | "notifRooms" | "avatarColor" | "avatarVariant">> }
  | { type: "delete_user"; userId: string }
  | { type: "list_active_sessions" }
  | { type: "revoke_session"; sessionPrefix: string }
  | { type: "logout" }
  | { type: "list_invites" }
  | {
      type: "mint_invite";
      requestId: string;
      username: string;
      role: UserRole;
      allowExisting?: boolean;
    }
  | { type: "mint_self_invite"; requestId: string }
  | { type: "revoke_invite"; tokenPrefix: string }
  | { type: "get_access_settings" }
  | {
      type: "update_access_settings";
      requestId: string;
      externalAccess: boolean;
      publicOrigin: string | null;
      officeName?: string | null;
    }
  | { type: "presence_update"; currentRoom: number | null; focusedAgentId: string | null; viewMode: "office" | "log" | "away"; device?: string | null }
  | { type: "ping" };

// Generate a stable 8-char hex room ID (used at room creation and during migration)
export function generateRoomId(existing?: string[]): string {
  return generateHexId(existing);
}
