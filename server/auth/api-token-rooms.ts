import type { UserRecord } from "../../shared/types.ts";
import { getUserById } from "../users.ts";
import type { ResolvedApiToken } from "./api-tokens.ts";

// A personal API token may be limited to some of its member's rooms.

export const MAX_API_TOKEN_ROOMS = 50;

// A room list a token may carry: 1–50 distinct room ids.
export function validApiTokenRooms(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.length <= MAX_API_TOKEN_ROOMS &&
    value.every((room) => typeof room === "string" && /^[A-Za-z0-9_-]{1,64}$/.test(room)) &&
    new Set(value).size === value.length
  );
}

// The member as a token sees them. A room-limited token keeps only its rooms
// the member can still see, and none of an owner's office-wide powers.
export function apiTokenViewer(token: ResolvedApiToken): UserRecord | null {
  const user = getUserById(token.userId);
  if (!user || !token.rooms) return user;
  const rooms = token.rooms.filter((room) => user.role === "owner" || user.allowedRooms.includes(room));
  return { ...user, role: "member", allowedRooms: rooms };
}

// The routes a room-limited token may call: agents, tasks and its own inbox.
// Every other route checks the member's own access, so the token is refused
// there rather than reaching past its rooms.
export function apiTokenRoomLimitedPath(pathname: string): boolean {
  return /^\/api\/(agents|tasks)(\/|$)/.test(pathname) || pathname === "/api/me/api-token-inbox/drain";
}
