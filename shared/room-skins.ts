// The look a room is drawn in. A skin changes floor/walls/props only — desks,
// characters, pets, and status lights stay the same under every skin.

export const ROOM_SKIN_IDS = ["office", "hospital"] as const;

/** Skins the room Look picker offers. */
export const SELECTABLE_ROOM_SKIN_IDS: readonly RoomSkin[] = ["office", "hospital"];

export type RoomSkin = (typeof ROOM_SKIN_IDS)[number];

export const DEFAULT_ROOM_SKIN: RoomSkin = "office";

export function isRoomSkin(value: unknown): value is RoomSkin {
  return typeof value === "string" && (ROOM_SKIN_IDS as readonly string[]).includes(value);
}

export function effectiveRoomSkin(room?: { skin?: RoomSkin | null }): RoomSkin {
  const skin = room?.skin;
  return isRoomSkin(skin) ? skin : DEFAULT_ROOM_SKIN;
}

export function parseRoomSkin(value: unknown): { ok: true; skin: RoomSkin | null } | { ok: false; reason: string } {
  if (value === null || value === undefined) return { ok: true, skin: null };
  if (!isRoomSkin(value)) {
    return { ok: false, reason: `skin must be null or one of: ${ROOM_SKIN_IDS.join(", ")}` };
  }
  return { ok: true, skin: value };
}

// Per-room decorative density. Decor controls optional wall/scene accents
// without changing the room skin, furniture layout, agents, desks, or pets.
export const ROOM_DECOR_IDS = ["minimal", "standard", "lively"] as const;

export type RoomDecor = (typeof ROOM_DECOR_IDS)[number];

export const DEFAULT_ROOM_DECOR: RoomDecor = "standard";

export function isRoomDecor(value: unknown): value is RoomDecor {
  return typeof value === "string" && (ROOM_DECOR_IDS as readonly string[]).includes(value);
}

export function effectiveRoomDecor(room?: { decor?: RoomDecor | null }): RoomDecor {
  const decor = room?.decor;
  return isRoomDecor(decor) ? decor : DEFAULT_ROOM_DECOR;
}

export function parseRoomDecor(value: unknown): { ok: true; decor: RoomDecor | null } | { ok: false; reason: string } {
  if (value === null || value === undefined) return { ok: true, decor: null };
  if (!isRoomDecor(value)) {
    return { ok: false, reason: `decor must be null or one of: ${ROOM_DECOR_IDS.join(", ")}` };
  }
  return { ok: true, decor: value };
}
