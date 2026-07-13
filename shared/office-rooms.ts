import type { AgentInfo, RoomWire } from "./types.ts";
import type { OfficeEvent } from "./office-events.ts";
import { firstOpenDesk } from "./office-agents.ts";
import { generateRoomId } from "./types.ts";

export function createRoomInList(rooms: RoomWire[], name?: string): { room: RoomWire; rooms: RoomWire[]; events: OfficeEvent[] } {
  const existingIds = rooms.map((r) => r.id);
  const room: RoomWire = {
    id: generateRoomId(existingIds),
    name: name || `Room ${rooms.length + 1}`,
    prompt: null,
    envFile: null,
  };
  return {
    room,
    rooms: [...rooms, room],
    events: [{ type: "room_created", room }],
  };
}

export function closeRoomInList(rooms: RoomWire[], agents: Iterable<AgentInfo>, roomId: string): { rooms: RoomWire[]; events: OfficeEvent[] } {
  const room = rooms.findIndex((r) => r.id === roomId);
  if (room <= 0) return { rooms, events: [] };
  const allAgents = [...agents];
  if (allAgents.some((a) => a.room === room)) return { rooms, events: [] };

  const events: OfficeEvent[] = [];
  for (const agent of allAgents) {
    if (agent.room > room) {
      agent.room--;
      events.push({ type: "agent_updated", agentId: agent.id, changes: { room: agent.room } });
    }
  }
  events.push({ type: "room_closed", roomId });
  return { rooms: rooms.filter((_, idx) => idx !== room), events };
}

export function renameRoomInList(rooms: RoomWire[], roomId: string, name: string): { rooms: RoomWire[]; events: OfficeEvent[] } {
  const room = rooms.findIndex((r) => r.id === roomId);
  if (room < 0) return { rooms, events: [] };
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) return { rooms, events: [] };

  const nextRooms = [...rooms];
  nextRooms[room] = { ...nextRooms[room], name: trimmed };
  return { rooms: nextRooms, events: [{ type: "room_renamed", roomId, name: trimmed }] };
}

export function moveAgentToRoom(agents: Iterable<AgentInfo>, agentId: string, targetRoom: number): OfficeEvent[] {
  const allAgents = [...agents];
  const agent = allAgents.find((a) => a.id === agentId);
  if (!agent || targetRoom < 0 || agent.room === targetRoom) return [];

  const newDesk = firstOpenDesk(allAgents, targetRoom);
  if (newDesk === -1) return [];

  agent.room = targetRoom;
  agent.desk = newDesk;
  return [{ type: "agent_updated", agentId, changes: { room: targetRoom, desk: newDesk } }];
}
