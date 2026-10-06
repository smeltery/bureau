import type { RoomWire } from "../shared/types.ts";

export function roomsInViewerOrder<T extends { id: string }>(available: readonly T[], visible: readonly { id: string }[]): T[] {
  const byId = new Map(available.map((room) => [room.id, room]));
  const ordered: T[] = [];
  for (const { id } of visible) {
    const room = byId.get(id);
    if (!room) continue;
    ordered.push(room);
    byId.delete(id);
  }
  return [...ordered, ...byId.values()];
}

export function resolveSelectedRoomId(rooms: RoomWire[], current: string | null, preferred: string | null = null): string | null {
  if (preferred && rooms.some((room) => room.id === preferred)) return preferred;
  if (current && rooms.some((room) => room.id === current)) return current;
  return rooms[0]?.id ?? null;
}

export function applyRoomClose(rooms: RoomWire[], closedId: string, current: string | null): { rooms: RoomWire[]; currentRoomId: string | null } | null {
  const idx = rooms.findIndex((room) => room.id === closedId);
  if (idx < 0) return null;

  const next = rooms.slice();
  next.splice(idx, 1);

  const currentRoomId = current === closedId ? (next[Math.min(idx, next.length - 1)]?.id ?? null) : current;
  return { rooms: next, currentRoomId };
}

export function roomIndexById(rooms: RoomWire[], roomId: string | null): number {
  if (!roomId) return 0;
  const idx = rooms.findIndex((room) => room.id === roomId);
  return idx < 0 ? 0 : idx;
}
