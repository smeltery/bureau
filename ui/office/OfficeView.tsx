import { useCallback, useEffect, useState } from "react";
import { useAppState, useDispatch, useTheme, useFeatures } from "../store.tsx";
import { Floor, Walls } from "./scene/Floor.tsx";
import { RoomProps } from "./scene/RoomProps.tsx";
import { Seasonal } from "./scene/Seasonal.tsx";
import { SCENE_W, SCENE_H } from "./grid.ts";
import { useGhostTransitions, type DoorCoord } from "./useGhostTransitions.ts";
import { getRoomCounts } from "../components/overlays/MobileHeader.tsx";
import { WallPanelMenu, type WallPanelMenuItem } from "../components/overlays/WallPanelMenu.tsx";
import { useSwipeLeftRight } from "../hooks/useSwipeLeftRight.ts";
import { useViewport } from "./useViewport.ts";
import { ZoomControls } from "./ZoomControls.tsx";
import type { AgentInfo } from "../../shared/types.ts";
import { BuildingIcon, DoorIcon } from "./OfficeHeader.tsx";
import { OfficeHints } from "./OfficeHints.tsx";
import { RoomDoorDropZones } from "./RoomDoorDropZones.tsx";
import { OfficeTopHud } from "./OfficeTopHud.tsx";
import { OfficePeopleLayer } from "./OfficePeopleLayer.tsx";
import { useOfficeDoorFeedback } from "./hooks/useOfficeDoorFeedback.ts";
import { useRoomSkinVars } from "./skins/index.tsx";

// Pixel coords (scene-container space) where ghosts park when sliding
// to/from a door on a room switch. Roughly centered horizontally on the
// DoorDropZone with the ghost-box top placed so the body sits in front
// of the door threshold. Module-level so the hook's effect deps stay stable.
const LEFT_DOOR_COORD: DoorCoord = { left: 25, top: 270 };
const RIGHT_DOOR_COORD: DoorCoord = { left: SCENE_W - 65, top: 270 };

export interface ViewportControls {
  resetView: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
}

export function OfficeView({
  onSpawn,
  onContextMenu,
  username,
  onEditUsername,
  onOpenUserSettingsForUser,
  onOpenDeviceSettings,
  onEditOfficePrompt,
  onEditRoomSettings,
  onOpenTasks,
  onOpenCronjobs,
  onOpenApps,
  onOpenPlugins,
  onOpenTeamChat,
  onOpenUpdate,
  onSwipeLeft,
  onSwipeRight,
  viewportControlsRef,
}: {
  onSpawn: (deskIndex: number) => void;
  onContextMenu: (x: number, y: number, agent: AgentInfo) => void;
  username: string;
  onEditUsername: () => void;
  onOpenUserSettingsForUser?: (userId: string) => void;
  onOpenDeviceSettings: () => void;
  onEditOfficePrompt: () => void;
  onEditRoomSettings?: () => void;
  onOpenTasks: () => void;
  onOpenCronjobs?: () => void;
  onOpenApps?: () => void;
  onOpenPlugins?: () => void;
  onOpenTeamChat?: () => void;
  onOpenUpdate: () => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  viewportControlsRef?: React.RefObject<ViewportControls | null>;
}) {
  const { agents, needsAttention, stateChangedAt, office, tasks, currentRoom, rooms, isMobile, updateStatus, presences, sessionContext } = useAppState();
  const roomCount = rooms.length;
  const roomNames = rooms.map((r) => r.name);
  const officePrompt = office.prompt;
  const dispatch = useDispatch();
  const { cycleTheme } = useTheme();
  const { embed } = useFeatures();
  const skinVars = useRoomSkinVars();
  const mobileScale = isMobile ? screen.width / (SCENE_W - 200) : 1;
  // layoutKey changes whenever the centered-scene static transform changes,
  // so useViewport re-measures pan-clamp bounds (ResizeObserver alone won't
  // catch transform-only updates).
  const layoutKey = `${embed ? 1 : 0}|${isMobile ? 1 : 0}|${mobileScale}`;
  const viewport = useViewport(layoutKey, !embed);
  // Cede one-finger swipes to pan once the user zooms in (iOS-gallery pattern).
  const swipeRef = useSwipeLeftRight(onSwipeLeft ?? (() => {}), onSwipeRight ?? (() => {}), isMobile, () => !viewport.isZoomedIn());
  const attachContainer = useCallback(
    (node: HTMLDivElement | null) => {
      swipeRef(node);
      viewport.setContainer(node);
    },
    [swipeRef, viewport.setContainer],
  );

  // Expose viewport controls to parent for keyboard shortcuts (0, +, -).
  // Skip in embed mode — the zoom UI is hidden there.
  useEffect(() => {
    if (!viewportControlsRef || embed) return;
    viewportControlsRef.current = {
      resetView: viewport.resetView,
      zoomIn: viewport.zoomIn,
      zoomOut: viewport.zoomOut,
    };
    return () => {
      viewportControlsRef.current = null;
    };
  }, [viewportControlsRef, embed, viewport.resetView, viewport.zoomIn, viewport.zoomOut]);

  // Filter agents to current room for rendering
  const roomAgents = agents.filter((a) => a.room === currentRoom);
  // Final ghost placement list — natural desk/lobby positions plus door-slide
  // overrides for ghosts whose presence just crossed into / out of our current
  // room. The hook owns all per-ghost coordinate state; OfficeView just renders.
  const ghostPlacements = useGhostTransitions(presences, roomAgents, currentRoom, sessionContext?.connectionId ?? null, LEFT_DOOR_COORD, RIGHT_DOOR_COORD);
  const doorFeedback = useOfficeDoorFeedback();
  const [wallMenu, setWallMenu] = useState<{ x: number; y: number } | null>(null);
  const setCurrentRoom = useCallback(
    (room: number) => {
      dispatch({ type: "set_current_room", room });
    },
    [dispatch],
  );

  const wallMenuItems: WallPanelMenuItem[] = [
    { id: "office", icon: <BuildingIcon />, label: "Office settings", onClick: onEditOfficePrompt },
    ...(onEditRoomSettings ? [{ id: "room", icon: <DoorIcon />, label: "Room settings", onClick: onEditRoomSettings }] : []),
  ];

  const counts = getRoomCounts(roomAgents);

  return (
    <div
      style={{
        height: isMobile ? "calc(100dvh - var(--banner-h, 0px))" : "calc(100vh - var(--banner-h, 0px))",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--bg-base)",
        color: "var(--text-primary)",
      }}
    >
      <OfficeTopHud
        counts={counts}
        embed={embed}
        isMobile={isMobile}
        username={username}
        updateAvailable={updateStatus.updateAvailable}
        onEditUsername={onEditUsername}
        onOpenDeviceSettings={onOpenDeviceSettings}
        onEditOfficePrompt={onEditOfficePrompt}
        onEditRoomSettings={onEditRoomSettings}
        onOpenTasks={onOpenTasks}
        onOpenCronjobs={onOpenCronjobs}
        onOpenApps={onOpenApps}
        onOpenPlugins={onOpenPlugins}
        onOpenTeamChat={onOpenTeamChat}
        onOpenUpdate={onOpenUpdate}
      />

      {/* Office scene */}
      {/* touch-action: none keeps iOS from turning one-finger drags into page
          scroll. Room-swipe still works because that hook reads touch
          coordinates directly. */}
      <div ref={attachContainer} style={{ flex: 1, position: "relative", overflow: "hidden", touchAction: "none" }}>
        {/* Ambient gradients */}
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "radial-gradient(ellipse at 50% 30%, var(--ambient-1) 0%, transparent 50%), radial-gradient(ellipse at 25% 65%, var(--ambient-2) 0%, transparent 35%), radial-gradient(ellipse at 75% 65%, var(--ambient-3) 0%, transparent 35%)",
            pointerEvents: "none",
          }}
        />

        {/* Viewport layer — zoom/pan transform applies here, wrapping the centered scene */}
        <div ref={viewport.setScene} style={{ position: "absolute", inset: 0, transformOrigin: "0 0" }}>
          {/* Centered scene container — static centering transform */}
          <div
            ref={viewport.setContent}
            style={{
              position: "absolute",
              left: "50%",
              top: embed ? (isMobile ? "55%" : "64%") : isMobile ? "45%" : "50%",
              transform: embed ? `translate(-50%, -50%) scale(${isMobile ? mobileScale * 0.85 : 0.9})` : isMobile ? `translate(-50%, -50%) scale(${mobileScale})` : "translate(-50%, -50%)",
              transformOrigin: "center center",
              width: SCENE_W,
              height: SCENE_H,
              ...skinVars,
            }}
          >
            <Walls
              onToggleTheme={cycleTheme}
              onWallPanelClick={(x, y) => setWallMenu({ x, y })}
              hasOfficePrompt={!!officePrompt}
              onOpenTasks={onOpenTasks}
              onOpenCronjobs={embed ? undefined : onOpenCronjobs}
              onOpenSettings={embed ? undefined : onEditUsername}
              onOpenApps={embed ? undefined : onOpenApps}
              taskCount={tasks.filter((t) => t.status !== "done" && t.status !== "backlog").length}
              leftDoor={
                currentRoom > 0
                  ? {
                      label: roomNames[currentRoom - 1] ?? `Room ${currentRoom}`,
                      onClick: () => dispatch({ type: "set_current_room", room: currentRoom - 1 }),
                      dragOver: doorFeedback.leftDoorDragOver,
                      reject: doorFeedback.leftDoorReject,
                    }
                  : null
              }
              rightDoor={
                currentRoom < roomCount - 1
                  ? {
                      label: roomNames[currentRoom + 1] ?? `Room ${currentRoom + 2}`,
                      onClick: () => dispatch({ type: "set_current_room", room: currentRoom + 1 }),
                      dragOver: doorFeedback.rightDoorDragOver,
                      reject: doorFeedback.rightDoorReject,
                    }
                  : null
              }
            />
            <Floor />
            <RoomProps />
            <Seasonal />
            <RoomDoorDropZones
              agents={agents}
              currentRoom={currentRoom}
              roomAgents={roomAgents}
              rooms={rooms}
              roomCount={roomCount}
              onSetRoom={setCurrentRoom}
              onLeftDragOverChange={doorFeedback.setLeftDoorDragOver}
              onRightDragOverChange={doorFeedback.setRightDoorDragOver}
              onLeftReject={doorFeedback.rejectLeftDoor}
              onRightReject={doorFeedback.rejectRightDoor}
            />
            <OfficePeopleLayer
              roomAgents={roomAgents}
              rooms={rooms}
              currentRoom={currentRoom}
              needsAttention={needsAttention}
              stateChangedAt={stateChangedAt}
              ghostPlacements={ghostPlacements}
              onSpawn={onSpawn}
              onFocusAgent={(agentId) => dispatch({ type: "focus", agentId })}
              onContextMenu={onContextMenu}
              onOpenUserSettingsForUser={onOpenUserSettingsForUser}
            />
          </div>
        </div>

        {/* Vignette */}
        {!embed && (
          <div
            style={{
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              boxShadow: "inset 0 0 120px var(--vignette)",
            }}
          />
        )}

        {!embed && <ZoomControls onZoomIn={viewport.zoomIn} onZoomOut={viewport.zoomOut} onReset={() => viewport.resetView()} />}
      </div>

      {/* Bottom HUD */}
      {!embed && <OfficeHints isMobile={isMobile} />}
      {wallMenu && <WallPanelMenu x={wallMenu.x} y={wallMenu.y} items={wallMenuItems} onClose={() => setWallMenu(null)} />}
    </div>
  );
}
