import type { AgentInfo, RoomWire } from "../../shared/types.ts";
import { send } from "../ws.ts";
import { DoorDropZone } from "./DoorDropZone.tsx";

export function RoomDoorDropZones({
  agents,
  currentRoom,
  roomAgents,
  rooms,
  roomCount,
  onSetRoom,
  onLeftDragOverChange,
  onRightDragOverChange,
  onLeftReject,
  onRightReject,
}: {
  agents: AgentInfo[];
  currentRoom: number;
  roomAgents: AgentInfo[];
  rooms: RoomWire[];
  roomCount: number;
  onSetRoom: (room: number) => void;
  onLeftDragOverChange: (over: boolean) => void;
  onRightDragOverChange: (over: boolean) => void;
  onLeftReject: () => void;
  onRightReject: () => void;
}) {
  return (
    <>
      {currentRoom > 0 && (
        <DoorDropZone
          side="left"
          onClick={() => onSetRoom(currentRoom - 1)}
          onDragOverChange={onLeftDragOverChange}
          onDrop={(deskIndex) => moveAgentThroughDoor({ agents, currentRoom, direction: -1, deskIndex, roomAgents, rooms, onReject: onLeftReject })}
        />
      )}
      {currentRoom < roomCount - 1 && (
        <DoorDropZone
          side="right"
          onClick={() => onSetRoom(currentRoom + 1)}
          onDragOverChange={onRightDragOverChange}
          onDrop={(deskIndex) => moveAgentThroughDoor({ agents, currentRoom, direction: 1, deskIndex, roomAgents, rooms, onReject: onRightReject })}
        />
      )}
    </>
  );
}

function moveAgentThroughDoor({
  agents,
  currentRoom,
  direction,
  deskIndex,
  roomAgents,
  rooms,
  onReject,
}: {
  agents: AgentInfo[];
  currentRoom: number;
  direction: -1 | 1;
  deskIndex: number;
  roomAgents: AgentInfo[];
  rooms: RoomWire[];
  onReject: () => void;
}): boolean {
  const agent = roomAgents.find((a) => a.desk === deskIndex);
  if (!agent) {
    onReject();
    return false;
  }
  const targetRoom = currentRoom + direction;
  const targetRoomId = rooms[targetRoom]?.id;
  if (!targetRoomId || agents.filter((x) => x.room === targetRoom).length >= 8) {
    onReject();
    return false;
  }
  send({ type: "move_agent", agentId: agent.id, targetRoomId });
  return true;
}
