// Lobby tab content for OfficeView: live scene or ?lobbyEdit=1 layout editor.
import { useEffect, useState } from "react";
import { useAppState, useDispatch, useTheme, useFeatures } from "../store.tsx";
import { send } from "../ws.ts";
import { LOBBY_ROOM_ID } from "../../shared/lobby.ts";
import { LobbyScene } from "./lobby/index.ts";
import { LobbyEditor } from "./lobby/LobbyEditor.tsx";
import { LobbyReceptionist } from "./LobbyReceptionist.tsx";
import { crownHolder, employeeOfTheMinute } from "./lobby/employee.ts";

export function lobbyEditFromUrl(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("lobbyEdit") === "1";
  } catch {
    return false;
  }
}

export function OfficeLobbyLayer({
  onOpenTeamChat,
  onFocusAgent,
  onOpenUserSettingsForUser,
  onOpenApps,
  onOpenCronjobs,
}: {
  onOpenTeamChat?: () => void;
  onFocusAgent?: (agentId: string) => void;
  onOpenUserSettingsForUser?: (userId: string) => void;
  onOpenApps?: () => void;
  onOpenCronjobs?: () => void;
}) {
  const { agents, stateChangedAt, office, rooms, presences, sessionContext, lobbyOpen } = useAppState();
  const dispatch = useDispatch();
  const { cycleTheme, mode, theme } = useTheme();
  const { embed } = useFeatures();
  const lobbyEdit = lobbyEditFromUrl();

  const leader = employeeOfTheMinute(
    agents.filter((a) => a.roomId !== LOBBY_ROOM_ID).map((a) => ({ id: a.id, roomId: a.roomId ?? rooms[a.room]?.id ?? "", desk: a.desk })),
    stateChangedAt,
    rooms.map((r) => r.id),
  );
  const leaderAt = leader ? (stateChangedAt.get(leader.id) ?? 0) : 0;
  const [held, setHeld] = useState<{ id: string; at: number } | null>(null);
  const nextHolder = crownHolder(held, leader ? { id: leader.id, at: leaderAt } : null);
  if (nextHolder !== (held?.id ?? null)) {
    setHeld(nextHolder ? { id: nextHolder, at: stateChangedAt.get(nextHolder) ?? 0 } : null);
  }
  const starAgent = held ? agents.find((a) => a.id === held.id) : undefined;
  const lobbyStar = starAgent ? { name: starAgent.name, outfit: starAgent.outfit } : null;
  const canMoveLobby = !!sessionContext && lobbyOpen && !lobbyEdit && presences.some((p) => p.connectionId === sessionContext.connectionId && p.currentRoomId === LOBBY_ROOM_ID);
  const receptionistLive = office.receptionistAgentId ? (agents.find((a) => a.id === office.receptionistAgentId) ?? null) : null;

  useEffect(() => {
    if (lobbyEdit && !lobbyOpen) dispatch({ type: "set_lobby_open", open: true });
  }, [lobbyEdit, lobbyOpen, dispatch]);

  if (lobbyEdit) {
    return <LobbyEditor initialLayout="fireside" themeId={theme} rooms={rooms.map((r) => ({ id: r.id, name: r.name }))} officeName={null} star={lobbyStar} />;
  }

  return (
    <LobbyScene
      rooms={rooms.map((r) => ({ id: r.id, name: r.name }))}
      officeName={null}
      mode={mode}
      layout="fireside"
      presences={presences}
      ownConnectionId={sessionContext?.connectionId ?? null}
      onOpenUser={onOpenUserSettingsForUser}
      onMoveGhost={canMoveLobby ? (spotId) => send({ type: "lobby_move", spotId }) : undefined}
      star={lobbyStar}
      receptionist={
        <LobbyReceptionist
          onOpenTeamChat={onOpenTeamChat}
          onOpenAgent={onFocusAgent}
          agent={receptionistLive ? { id: receptionistLive.id, name: receptionistLive.name, outfit: receptionistLive.outfit } : null}
        />
      }
      rightDoor={
        rooms[0]
          ? {
              label: rooms[0].name,
              onClick: () => dispatch({ type: "set_current_room", room: 0 }),
            }
          : null
      }
      onToggleTheme={cycleTheme}
      onOpenApps={embed ? undefined : onOpenApps}
      onOpenCronjobs={embed ? undefined : onOpenCronjobs}
    />
  );
}
