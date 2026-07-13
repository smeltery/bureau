import type { AgentBackendType, AgentInfo, AgentOutfit, KilledAgentSummary, SessionInfo, SkillInfo } from "./agent-types.ts";
import type { CodexSandboxMode, EffortLevel } from "./agent-models.ts";
import type { CCPluginsState } from "./cc-plugin-types.ts";
import type { Cronjob, CronjobPermissionMode, CronjobRun, Schedule } from "./cronjobs.ts";
import type { Attachment, LogEntry } from "./log-types.ts";
import type { TaskItem, TaskPriority } from "./tasks.ts";
import type { InviteWire, OfficeSettings, PresenceInfo, RoomWire, SessionContext, SessionWire, UserRecord, UserRole } from "./user-types.ts";

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
  scope: "office" | "room" | "user";
  roomId?: string;
  userId?: string;
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

// Browser -> Server commands
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
  | {
      type: "set_agent_privileged";
      requestId?: string;
      agentId: string;
      privileged: boolean;
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
  | { type: "request_settings_validation"; requestId: string; scope: "office" | "room" | "user"; roomId?: string; userId?: string; envFile?: string | null }
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
  | { type: "send_now"; agentId: string }
  | {
      type: "add_cronjob";
      requestId?: string;
      name: string;
      schedule: Schedule;
      prompt: string;
      cwd: string;
      agentType?: AgentBackendType;
      modelFamily: string;
      effort?: EffortLevel;
      permissionMode: CronjobPermissionMode;
      codexSandbox?: CodexSandboxMode;
      username: string;
      device?: string;
    }
  | {
      type: "update_cronjob";
      requestId?: string;
      id: string;
      changes: Partial<Pick<Cronjob, "name" | "schedule" | "prompt" | "cwd" | "modelFamily" | "effort" | "permissionMode" | "codexSandbox" | "enabled">>;
    }
  | { type: "delete_cronjob"; id: string }
  | { type: "run_cronjob_now"; id: string; username: string; device?: string }
  | { type: "update_cronjobs_prompt"; requestId: string; value: string | null }
  | { type: "list_cronjob_runs"; cronjobId: string }
  | { type: "list_all_cronjob_runs" }
  | { type: "load_cronjob_run"; cronjobId: string; runId: string }
  | { type: "send_cronjob_run_message"; cronjobId: string; runId: string; text: string; username?: string }
  | { type: "edit_cronjob_run_message"; cronjobId: string; runId: string; logEntryId: string; newText: string; username?: string }
  | { type: "claim_user"; username: string }
  | {
      type: "update_user";
      userId: string;
      changes: Partial<Pick<UserRecord, "name" | "role" | "envFile" | "memberPrompt" | "allowedRooms" | "hidden" | "order" | "defaultRoomId" | "notifRooms" | "avatarColor" | "avatarVariant">>;
    }
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
  | { type: "presence_update"; currentRoom: number | null; currentRoomId?: string | null; focusedAgentId: string | null; viewMode: "office" | "log" | "away"; device?: string | null }
  | { type: "ping" };
