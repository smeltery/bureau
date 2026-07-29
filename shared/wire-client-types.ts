import type { AgentBackendType, AgentInfo, AgentOutfit } from "./agent-types.ts";
import type { CodexSandboxMode, EffortLevel } from "./agent-models.ts";
import type { Cronjob, CronjobPermissionMode, Schedule } from "./cronjobs.ts";
import type { Attachment } from "./log-types.ts";
import type { TaskItem, TaskPriority } from "./tasks.ts";
import type { UserRecord, UserRole } from "./user-types.ts";

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
  | { type: "editor_save"; agentId: string; path: string; content: string; expectedMtime: number; expectedRev?: number; force?: boolean }
  | { type: "editor_close"; agentId: string; path: string }
  | { type: "update_office_settings"; requestId: string; prompt: string | null; envFile: string | null }
  | { type: "update_room_settings"; requestId: string; roomId: string; prompt: string | null; envFile: string | null }
  | { type: "request_settings_validation"; requestId: string; scope: "office" | "room" | "user"; roomId?: string; userId?: string; envFile?: string | null }
  | { type: "request_cwd_validation"; requestId: string; cwd: string }
  | { type: "add_task"; title: string; description?: string; priority?: TaskPriority; assignee?: string; roomId?: string; username: string }
  | { type: "update_task"; id: string; changes: Partial<Omit<Pick<TaskItem, "title" | "description" | "priority" | "status" | "assignee" | "roomId">, "priority"> & { priority: TaskPriority | null }> }
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
      allowedRooms?: string[];
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
      previewAllowHosts?: string[];
    }
  | { type: "presence_update"; currentRoom: number | null; currentRoomId?: string | null; focusedAgentId: string | null; viewMode: "office" | "log" | "away"; device?: string | null }
  | { type: "ping" };
