// Per-room notification gating. notifRooms is a strict allowlist of roomIds —
// no "all" sentinel. A null roomId (e.g. an agent whose room couldn't be
// resolved) never notifies. Used by the sound + desktop-notification effect
// in ui/store.tsx and validated server-side in server/users.ts.

export function shouldNotifyRoom(roomId: string | null, notifRooms: string[]): boolean {
  if (roomId == null) return false;
  return notifRooms.includes(roomId);
}
