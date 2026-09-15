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
