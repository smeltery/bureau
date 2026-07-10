import type { AgentInfo, RoomWire, UserRecord } from "../shared/types.ts";

function validRoomSet(roomIds: string[]): Set<string> {
  return new Set(roomIds);
}

export function normalizeAllowedRooms(value: unknown, allRoomIds: string[]): string[] {
  const valid = validRoomSet(allRoomIds);
  const raw = Array.isArray(value) ? value : allRoomIds;
  return raw.filter((id): id is string => typeof id === "string" && valid.has(id));
}

export function reconcileUserRooms(user: UserRecord, allRoomIds: string[]): UserRecord {
  const allowedRooms = normalizeAllowedRooms(user.allowedRooms, allRoomIds);
  const nextAllowed = user.role === "owner" && allowedRooms.length === 0 ? allRoomIds : allowedRooms;
  const hidden = Array.isArray(user.hidden) ? user.hidden.filter((id) => nextAllowed.includes(id)) : [];
  const hiddenSet = new Set(hidden);
  const order = Array.isArray(user.order) ? user.order.filter((id, index, arr) => nextAllowed.includes(id) && arr.indexOf(id) === index) : [];
  const shownRooms = nextAllowed.filter((id) => !hiddenSet.has(id));
  const defaultRoomId = user.defaultRoomId && shownRooms.includes(user.defaultRoomId) ? user.defaultRoomId : (shownRooms[0] ?? null);
  const notifRooms = (user.notifRooms ?? []).filter((id) => shownRooms.includes(id));
  if (
    nextAllowed.length === user.allowedRooms.length &&
    nextAllowed.every((id, i) => id === user.allowedRooms[i]) &&
    hidden.length === (user.hidden ?? []).length &&
    hidden.every((id, i) => id === (user.hidden ?? [])[i]) &&
    order.length === (user.order ?? []).length &&
    order.every((id, i) => id === (user.order ?? [])[i]) &&
    defaultRoomId === user.defaultRoomId &&
    notifRooms.length === user.notifRooms.length &&
    notifRooms.every((id, i) => id === user.notifRooms[i])
  )
    return user;
  return { ...user, allowedRooms: nextAllowed, hidden, order, defaultRoomId, notifRooms };
}

export function projectRooms(user: UserRecord | null, rooms: RoomWire[]): RoomWire[] {
  if (!user) return rooms;
  const accessible = user.role === "owner" ? rooms : rooms.filter((r) => user.allowedRooms.includes(r.id));
  const hidden = new Set(user.hidden ?? []);
  const orderRank = new Map<string, number>();
  for (const id of user.order ?? []) {
    if (!orderRank.has(id)) orderRank.set(id, orderRank.size);
  }
  return accessible
    .filter((r) => !hidden.has(r.id))
    .map((room, officeIndex) => ({ room, officeIndex }))
    .sort((a, b) => {
      const ar = orderRank.get(a.room.id) ?? Infinity;
      const br = orderRank.get(b.room.id) ?? Infinity;
      return ar === br ? a.officeIndex - b.officeIndex : ar - br;
    })
    .map(({ room }) => room);
}

export function projectAgents(user: UserRecord | null, agents: AgentInfo[], rooms: RoomWire[]): AgentInfo[] {
  const withRoomIds = agents.map((agent) => ({ ...agent, roomId: rooms[agent.room]?.id }));
  if (!user) return withRoomIds;
  const projectedRooms = projectRooms(user, rooms);
  const visibleRoomIds = new Set(projectedRooms.map((room) => room.id));
  if (user.role === "owner" && projectedRooms.length === rooms.length && projectedRooms.every((room, index) => room.id === rooms[index]?.id)) return withRoomIds;
  const projectedIndex = new Map(projectedRooms.map((room, index) => [room.id, index]));
  return withRoomIds
    .filter((agent) => visibleRoomIds.has(rooms[agent.room]?.id ?? ""))
    .map((agent) => {
      const roomId = rooms[agent.room]?.id;
      const room = roomId ? projectedIndex.get(roomId) : undefined;
      return room === undefined ? agent : { ...agent, room };
    });
}
