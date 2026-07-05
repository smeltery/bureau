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
      .map((u) => {
        const allowedRooms = Array.isArray(u.allowedRooms) ? u.allowedRooms.filter((id): id is string => typeof id === "string") : [];
        const hidden = Array.isArray(u.hidden) ? u.hidden.filter((id): id is string => typeof id === "string") : [];
        const order = Array.isArray(u.order) ? u.order.filter((id): id is string => typeof id === "string") : [];
        // Legacy records predate notifRooms — default to a snapshot of the
        // user's allowed rooms (notify everywhere they can see) and keep only
        // ids that are still in the allowed set.
        const notifRooms = Array.isArray(u.notifRooms) ? u.notifRooms.filter((id): id is string => typeof id === "string" && allowedRooms.includes(id)) : [...allowedRooms];
        return {
          id: u.id,
          name: u.name,
          role: u.role === "owner" ? "owner" : "member",
          envFile: typeof u.envFile === "string" && u.envFile ? u.envFile : null,
          memberPrompt: typeof u.memberPrompt === "string" && u.memberPrompt.trim() ? u.memberPrompt.trim() : null,
          allowedRooms,
          hidden,
          order,
          defaultRoomId: typeof u.defaultRoomId === "string" ? u.defaultRoomId : null,
          notifRooms,
          avatarColor: isHexColor(u.avatarColor) ? normalizeHexColor(u.avatarColor) : defaultGhostColorForUserId(u.id),
          avatarVariant: isGhostVariant(u.avatarVariant) ? u.avatarVariant : "classic",
          createdAt: typeof u.createdAt === "number" ? u.createdAt : Date.now(),
        };
      });
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
