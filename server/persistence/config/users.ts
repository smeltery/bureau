import { existsSync, readFileSync } from "fs";
import type { UserRecord } from "../../../shared/types.ts";
import { generateRoomId } from "../../../shared/types.ts";
import { defaultGhostColorForUserId, isGhostVariant, isHexColor, normalizeHexColor } from "../../../shared/avatar.ts";
import { atomicWriteFileSync, USERS_FILE } from "../paths.ts";

export function normalizeUserKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

export function generateUserId(existing?: string[]): string {
  return generateRoomId(existing);
}

export function loadUsers(): UserRecord[] {
  try {
    if (!existsSync(USERS_FILE)) return [];
    const parsed = JSON.parse(readFileSync(USERS_FILE, "utf-8"));
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((u): u is UserRecord => u && typeof u === "object" && typeof u.id === "string" && typeof u.name === "string")
      .map((u) => ({
        id: u.id,
        name: u.name,
        role: u.role === "owner" ? "owner" : "member",
        allowedRooms: Array.isArray(u.allowedRooms) ? u.allowedRooms.filter((id): id is string => typeof id === "string") : [],
        defaultRoomId: typeof u.defaultRoomId === "string" ? u.defaultRoomId : null,
        avatarColor: isHexColor(u.avatarColor) ? normalizeHexColor(u.avatarColor) : defaultGhostColorForUserId(u.id),
        avatarVariant: isGhostVariant(u.avatarVariant) ? u.avatarVariant : "classic",
        createdAt: typeof u.createdAt === "number" ? u.createdAt : Date.now(),
      }));
  } catch (err) {
    console.error("Failed to load users:", err);
    return [];
  }
}

export function saveUsers(users: UserRecord[]) {
  try {
    atomicWriteFileSync(USERS_FILE, JSON.stringify(users, null, 2));
  } catch (err) {
    console.error("Failed to save users:", err);
  }
}
