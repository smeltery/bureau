import type { UserRecord } from "../shared/types.ts";
import { defaultGhostColorForUserId, isGhostVariant, isHexColor, normalizeHexColor } from "../shared/avatar.ts";
import { isSupportedLanguage } from "../shared/languages.ts";
import { normalizeAllowedRooms } from "./user-room-projection.ts";

export type UserRecordChanges = Partial<
  Pick<UserRecord, "name" | "role" | "envFile" | "memberPrompt" | "language" | "slideMode" | "allowedRooms" | "hidden" | "order" | "defaultRoomId" | "notifRooms" | "avatarColor" | "avatarVariant">
>;

export function createUserRecord({ id, name, role, allowedRooms }: Pick<UserRecord, "id" | "name" | "role" | "allowedRooms">): UserRecord {
  return {
    id,
    name,
    role,
    envFile: null,
    memberPrompt: null,
    language: null,
    slideMode: false,
    allowedRooms,
    hidden: [],
    order: [],
    defaultRoomId: allowedRooms[0] ?? null,
    notifRooms: [...allowedRooms],
    avatarColor: defaultGhostColorForUserId(id),
    avatarVariant: "classic",
    createdAt: Date.now(),
  };
}

function applyProfileFields(next: UserRecord, changes: UserRecordChanges): void {
  if (typeof changes.name === "string") {
    const name = changes.name.trim().slice(0, 64);
    if (name) next.name = name;
  }
  if (changes.envFile !== undefined) {
    const envFile = typeof changes.envFile === "string" ? changes.envFile.trim() : "";
    next.envFile = envFile || null;
  }
  if (changes.memberPrompt !== undefined) {
    const memberPrompt = typeof changes.memberPrompt === "string" ? changes.memberPrompt.trim() : "";
    next.memberPrompt = memberPrompt || null;
  }
  if (changes.language !== undefined) next.language = isSupportedLanguage(changes.language) ? changes.language : null;
  if (typeof changes.slideMode === "boolean") next.slideMode = changes.slideMode;
  if (changes.avatarColor !== undefined && isHexColor(changes.avatarColor)) next.avatarColor = normalizeHexColor(changes.avatarColor);
  if (changes.avatarVariant !== undefined && isGhostVariant(changes.avatarVariant)) next.avatarVariant = changes.avatarVariant;
}

export function applyBootstrapUserChanges(target: UserRecord, changes: UserRecordChanges): UserRecord {
  const next: UserRecord = { ...target };
  applyProfileFields(next, changes);
  if (changes.role === "owner" || changes.role === "member") next.role = changes.role;
  if (Array.isArray(changes.allowedRooms)) {
    next.allowedRooms = changes.allowedRooms.filter((id): id is string => typeof id === "string");
  }
  if (Array.isArray(changes.hidden)) {
    next.hidden = changes.hidden.filter((id): id is string => typeof id === "string");
  }
  if (Array.isArray(changes.order)) {
    next.order = changes.order.filter((id): id is string => typeof id === "string");
  }
  if (changes.defaultRoomId !== undefined) {
    next.defaultRoomId = typeof changes.defaultRoomId === "string" ? changes.defaultRoomId : null;
  }
  if (Array.isArray(changes.notifRooms)) {
    next.notifRooms = changes.notifRooms.filter((id): id is string => typeof id === "string" && next.allowedRooms.includes(id));
  }
  return next;
}

export function applyInteractiveUserChanges(target: UserRecord, actor: UserRecord, changes: UserRecordChanges, allRoomIds: string[]): UserRecord {
  const next: UserRecord = { ...target };
  applyProfileFields(next, changes);
  if (actor.role === "owner") {
    if (changes.role === "owner" || changes.role === "member") next.role = changes.role;
    if (changes.allowedRooms) next.allowedRooms = normalizeAllowedRooms(changes.allowedRooms, allRoomIds);
  }
  const accessRooms = next.role === "owner" ? allRoomIds : next.allowedRooms;
  if (Array.isArray(changes.hidden)) {
    next.hidden = changes.hidden.filter((id): id is string => typeof id === "string" && accessRooms.includes(id));
  } else {
    next.hidden = (next.hidden ?? []).filter((id) => accessRooms.includes(id));
  }
  if (Array.isArray(changes.order)) {
    const seen = new Set<string>();
    next.order = changes.order.filter((id): id is string => {
      if (typeof id !== "string" || !accessRooms.includes(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
  } else {
    next.order = (next.order ?? []).filter((id) => accessRooms.includes(id));
  }
  const hiddenSet = new Set(next.hidden);
  const shownRooms = accessRooms.filter((id) => !hiddenSet.has(id));
  if (changes.defaultRoomId !== undefined) {
    next.defaultRoomId = typeof changes.defaultRoomId === "string" && shownRooms.includes(changes.defaultRoomId) ? changes.defaultRoomId : null;
  } else if (next.defaultRoomId && !shownRooms.includes(next.defaultRoomId)) {
    next.defaultRoomId = shownRooms[0] ?? null;
  }
  if (Array.isArray(changes.notifRooms)) {
    next.notifRooms = changes.notifRooms.filter((id): id is string => typeof id === "string" && shownRooms.includes(id));
  }
  if (next.role === "owner" && next.allowedRooms.length === 0) next.allowedRooms = allRoomIds;
  next.notifRooms = next.notifRooms.filter((id) => shownRooms.includes(id));
  return next;
}
