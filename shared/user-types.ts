import type { GhostVariant } from "./avatar.ts";

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
  // Optional dotenv file applied to agents and cronjobs owned by this user.
  envFile: string | null;
  // User-authored context injected into agents owned by this user.
  memberPrompt: string | null;
  // Strict list of room IDs this user can see and act in. Owners can edit it.
  allowedRooms: string[];
  // Per-user view preferences layered on top of access. Hidden rooms remain
  // accessible; they are only omitted from this user's room list. Order is a
  // sparse room-id list; any visible rooms not listed keep office order after it.
  hidden: string[];
  order: string[];
  defaultRoomId: string | null;
  // Rooms this user gets notification sounds / desktop alerts for. Strict
  // string[] of roomIds; no "all" sentinel. New users get a snapshot of
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
  currentRoomId?: string | null;
  currentRoom: number | null;
  focusedAgentId: string | null;
  viewMode: "office" | "log" | "away";
}

export interface SessionWire {
  sessionPrefix: string;
  userId: string;
  username: string;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number;
  absoluteExpiresAt: number;
  userAgent?: string | null;
}

// Wire shape for an outstanding invite (owner UI). Raw token never crosses
// the wire; only the 8-char display prefix.
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
