import type { AgentInfo, RoomWire } from "../../shared/types.ts";
import { send } from "../ws.ts";
import { DeskUnit } from "./scene/DeskUnit.tsx";
import { EmptySlot } from "./scene/EmptySlot.tsx";
import { GhostBody, GhostTag } from "./Ghost.tsx";
import type { GhostPlacement } from "./useGhostTransitions.ts";

const GHOST_SIZE = 40;

export function OfficePeopleLayer({
  roomAgents,
  rooms,
  currentRoom,
  needsAttention,
  stateChangedAt,
  ghostPlacements,
  onSpawn,
  onFocusAgent,
  onContextMenu,
  onOpenUserSettingsForUser,
}: {
  roomAgents: AgentInfo[];
  rooms: RoomWire[];
  currentRoom: number;
  needsAttention: Set<string>;
  stateChangedAt: Map<string, number>;
  ghostPlacements: GhostPlacement[];
  onSpawn: (deskIndex: number) => void;
  onFocusAgent: (agentId: string) => void;
  onContextMenu: (x: number, y: number, agent: AgentInfo) => void;
  onOpenUserSettingsForUser?: (userId: string) => void;
}) {
  function swapDesks(deskA: number, deskB: number) {
    const roomId = rooms[currentRoom]?.id;
    if (roomId) send({ type: "swap_desks", deskA, deskB, roomId });
  }

  return (
    <>
      {Array.from({ length: 8 }, (_, i) => {
        const agent = roomAgents.find((candidate) => candidate.desk === i);
        if (agent) {
          return (
            <DeskUnit
              key={agent.id}
              agent={agent}
              onClick={() => onFocusAgent(agent.id)}
              onContextMenu={(e) => onContextMenu(e.clientX, e.clientY, agent)}
              needsAttention={needsAttention.has(agent.id)}
              onSwap={swapDesks}
              stateChangedAt={stateChangedAt.get(agent.id)}
            />
          );
        }
        return <EmptySlot key={`empty-${i}`} deskIndex={i} onClick={() => onSpawn(i)} onSwap={swapDesks} />;
      })}
      {ghostPlacements.map((placement) => (
        <GhostBody
          key={`body-${placement.presence.connectionId}`}
          left={placement.left}
          top={placement.top}
          size={GHOST_SIZE}
          variant={placement.presence.avatarVariant}
          color={placement.presence.avatarColor}
          username={placement.presence.username}
          device={placement.presence.device}
          userId={placement.presence.userId}
          dimmed={placement.dimmed}
          onClick={onOpenUserSettingsForUser}
        />
      ))}
      {ghostPlacements.map((placement) => (
        <GhostTag
          key={`tag-${placement.presence.connectionId}`}
          left={placement.left}
          top={placement.top}
          size={GHOST_SIZE}
          variant={placement.presence.avatarVariant}
          color={placement.presence.avatarColor}
          username={placement.presence.username}
          device={placement.presence.device}
          userId={placement.presence.userId}
          dimmed={placement.dimmed}
          onClick={onOpenUserSettingsForUser}
        />
      ))}
    </>
  );
}
