import type { AgentInfo, KilledAgentSummary, SessionInfo, SkillInfo } from "./agent-types.ts";
import type { AppListWire } from "./apps.ts";
import type { CCPluginsState } from "./cc-plugin-types.ts";
import type { Cronjob, CronjobRun } from "./cronjobs.ts";
import type { LogEntry } from "./log-types.ts";
import type { SlideFailureReason, SlideRecord } from "./slides.ts";
import type { TaskItem } from "./tasks.ts";
import type { InviteWire, OfficeSettings, PresenceInfo, RoomPet, RoomWire, SessionContext, SessionWire, UserRecord } from "./user-types.ts";
import type { AgentSaveResponse, CwdValidationResponse, SettingsSaveResponse, SettingsValidationResponse } from "./wire-response-types.ts";
import type { UpdateStatusWire } from "./update-types.ts";

// Server -> Browser messages
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
      previewAllowHosts?: string[];
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
      previewAllowHosts?: string[];
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
  // End of the transcript replay that follows full_state on every (re)connect.
  // Without it the replay is an unterminated burst of log_entry frames, and a
  // client that wants to swap the whole transcript in at once has to guess when
  // the burst ended — a guess that shows either a blank conversation or a stale
  // one. Sent per socket, right after the last replayed frame, by
  // sendInitialPayload (the only place that replays). Carries no payload: the
  // frames themselves are the content, this is only the fence at the end. A
  // client that never receives it (old server, dropped frame) must still
  // converge on its own.
  | { type: "log_replay_complete" }
  // Slide Mode. `slide_ready` carries the same SlideRecord the ensure-slide
  // route answers a cache hit with, so the deck and the sidecar file cannot
  // drift. Generation is fire-and-forget in the manager — the route never
  // blocks on the model — so this push is how a slide that had to be generated
  // reaches the deck. Room-ACL scoped like log_entry: anyone who can see the
  // chat gets it. The client matches it into the open deck by agentId +
  // entryId; sessionId is the conversation the slide belongs to (informational
  // for a future multi-conversation browser).
  | { type: "slide_ready"; agentId: string; sessionId: string; entryId: string; slide: SlideRecord }
  // Slide Mode: a slide generation FAILED terminally for one turn. The client's
  // only authoritative "stop waiting" signal: without it a failure is
  // indistinguishable from a slow generation, and the deck can only guess with
  // a timeout. Same room-ACL scope and matching (agentId + entryId) as
  // slide_ready.
  | { type: "slide_failed"; agentId: string; sessionId: string; entryId: string; reason: SlideFailureReason }
  | { type: "sessions_list"; agentId: string; sessions: SessionInfo[]; currentSessionId: string | null }
  | { type: "slash_commands"; agentId: string; commands: { name: string; description?: string; aliasFor?: string; autoRun?: boolean }[]; skills: SkillInfo[] }
  | { type: "clear_logs"; agentId: string }
  | { type: "terminal_output"; agentId: string; data: string; replay?: boolean }
  | { type: "terminal_exit"; agentId: string; exitCode: number }
  | { type: "editor_content"; agentId: string; path: string; content: string; mtime: number; rev: number; language: string; size: number }
  | { type: "editor_save_response"; agentId: string; path: string; ok: boolean; mtime?: number; rev?: number; error?: string; reason?: "stale" | "deleted"; currentMtime?: number }
  | { type: "editor_external_change"; agentId: string; path: string; mtime: number }
  | { type: "editor_file_deleted"; agentId: string; path: string }
  | { type: "editor_open_error"; agentId: string; path: string; reason: "not_found" | "not_file" | "binary" | "too_large" | "io_error" | "bad_path"; message?: string; size?: number }
  | { type: "office_settings_updated"; prompt: string | null; envFile: string | null }
  | { type: "tasks"; tasks: TaskItem[] }
  // App registry changes. `app_updated` carries the recipient's list projection.
  | { type: "app_updated"; app: AppListWire }
  | { type: "app_removed"; name: string }
  | { type: "room_created"; room: RoomWire }
  | { type: "room_closed"; roomId: string }
  | { type: "room_renamed"; roomId: string; name: string }
  | { type: "room_settings_updated"; roomId: string; prompt: string | null; envFile: string | null }
  | { type: "room_pet_updated"; roomId: string; pet: RoomPet | null }
  | { type: "room_skin_updated"; roomId: string; skin: import("./types.ts").RoomSkin | null }
  | { type: "rooms_reordered"; order: string[] }
  | SettingsSaveResponse
  | SettingsValidationResponse
  | AgentSaveResponse
  | CwdValidationResponse
  | ({ type: "update_status" } & UpdateStatusWire)
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
