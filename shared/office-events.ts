import type { AgentInfo, OfficeSettings, RoomWire, TaskItem } from "./types.ts";
import type { RoomPet } from "./user-types.ts";

// Domain events — callers translate these to ServerMessage
export type OfficeEvent =
  | { type: "agent_added"; agent: AgentInfo }
  | { type: "agent_removed"; agentId: string }
  | { type: "agent_updated"; agentId: string; changes: Partial<AgentInfo> }
  | { type: "room_created"; room: RoomWire }
  | { type: "room_closed"; roomId: string }
  | { type: "room_renamed"; roomId: string; name: string }
  | { type: "room_settings_updated"; roomId: string; prompt: string | null; envFile: string | null }
  | { type: "room_pet_updated"; roomId: string; pet: RoomPet | null }
  | { type: "room_skin_updated"; roomId: string; skin: import("./room-skins.ts").RoomSkin | null }
  | { type: "office_settings_updated"; prompt: string | null; envFile: string | null }
  | { type: "tasks_changed"; tasks: TaskItem[] };

export interface OfficeStateData {
  agents: AgentInfo[];
  rooms: RoomWire[];
  office: OfficeSettings;
  tasks: TaskItem[];
  recentCwds: string[];
}
