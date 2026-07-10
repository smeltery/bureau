import { useCallback, useEffect, useState } from "react";
import { useAppState, useDispatch, useTheme, useFeatures } from "../store.tsx";
import { Floor, Walls } from "./scene/Floor.tsx";
import { RoomProps } from "./scene/RoomProps.tsx";
import { RoomTabBar } from "./RoomTabBar.tsx";
import { DeskUnit } from "./scene/DeskUnit.tsx";
import { EmptySlot } from "./scene/EmptySlot.tsx";
import { StatusLight } from "./scene/StatusLight.tsx";
import { SCENE_W, SCENE_H } from "./grid.ts";
import { useGhostTransitions, type DoorCoord } from "./useGhostTransitions.ts";
import { GhostBody, GhostTag } from "./Ghost.tsx";
import { send } from "../ws.ts";
import { ThemePicker } from "../components/ThemePicker.tsx";
import { MobileHeader, getRoomCounts } from "../components/overlays/MobileHeader.tsx";
import { WallPanelMenu, type WallPanelMenuItem } from "../components/overlays/WallPanelMenu.tsx";
import { useSwipeLeftRight } from "../hooks/useSwipeLeftRight.ts";
import { useViewport } from "./useViewport.ts";
import { ZoomControls } from "./ZoomControls.tsx";
import type { AgentInfo } from "../../shared/types.ts";
import { BuildingIcon, DesktopOfficeHeader, DoorIcon } from "./OfficeHeader.tsx";
import { DoorDropZone } from "./DoorDropZone.tsx";
import { OfficeHints } from "./OfficeHints.tsx";

const GHOST_SIZE = 40;

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
  onOpenPlugins,
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
  onOpenPlugins?: () => void;
  onOpenUpdate: () => void;
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  viewportControlsRef?: React.RefObject<ViewportControls | null>;
}) {
  const { agents, needsAttention, stateChangedAt, office, tasks, currentRoom, rooms, isMobile, updateAvailable, presences, sessionContext } = useAppState();
  const roomCount = rooms.length;
  const roomNames = rooms.map((r) => r.name);
  const officePrompt = office.prompt;
  const dispatch = useDispatch();
  const { mode, toggleTheme } = useTheme();
  const [themePickerOpen, setThemePickerOpen] = useState(false);
  const { embed } = useFeatures();
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
  const [leftDoorDragOver, setLeftDoorDragOver] = useState(false);
  const [rightDoorDragOver, setRightDoorDragOver] = useState(false);
  const [leftDoorReject, setLeftDoorReject] = useState(false);
  const [rightDoorReject, setRightDoorReject] = useState(false);
  const [wallMenu, setWallMenu] = useState<{ x: number; y: number } | null>(null);

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
      {/* Top HUD bar */}
      {embed ? null : isMobile ? (
        <MobileHeader
          viewMode="office"
          onToggleView={() => dispatch({ type: "toggle_mobile_view" })}
          counts={counts}
          onOpenTasks={onOpenTasks}
          onEditUsername={onEditUsername}
          onOpenDeviceSettings={onOpenDeviceSettings}
          onEditOfficePrompt={onEditOfficePrompt}
          onEditRoomSettings={onEditRoomSettings}
          updateAvailable={updateAvailable}
          onOpenUpdate={onOpenUpdate}
        />
      ) : (
        <DesktopOfficeHeader
          counts={counts}
          mode={mode}
          username={username}
          updateAvailable={updateAvailable}
          onOpenTasks={onOpenTasks}
          onOpenCronjobs={onOpenCronjobs}
          onOpenPlugins={onOpenPlugins}
          onEditUsername={onEditUsername}
          onOpenDeviceSettings={onOpenDeviceSettings}
          onEditOfficePrompt={onEditOfficePrompt}
          onEditRoomSettings={onEditRoomSettings}
          onOpenUpdate={onOpenUpdate}
          onOpenTheme={() => setThemePickerOpen(true)}
        />
      )}

      {!embed && <RoomTabBar />}

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
            }}
          >
            <Walls
              onToggleTheme={toggleTheme}
              onWallPanelClick={(x, y) => setWallMenu({ x, y })}
              hasOfficePrompt={!!officePrompt}
              onOpenTasks={onOpenTasks}
              taskCount={tasks.filter((t) => t.status !== "done" && t.status !== "backlog").length}
              leftDoor={
                currentRoom > 0
                  ? {
                      label: roomNames[currentRoom - 1] ?? `Room ${currentRoom}`,
                      onClick: () => dispatch({ type: "set_current_room", room: currentRoom - 1 }),
                      dragOver: leftDoorDragOver,
                      reject: leftDoorReject,
                    }
                  : null
              }
              rightDoor={
                currentRoom < roomCount - 1
                  ? {
                      label: roomNames[currentRoom + 1] ?? `Room ${currentRoom + 2}`,
                      onClick: () => dispatch({ type: "set_current_room", room: currentRoom + 1 }),
                      dragOver: rightDoorDragOver,
                      reject: rightDoorReject,
                    }
                  : null
              }
            />
            <Floor />
            <RoomProps />
            {currentRoom > 0 && (
              <DoorDropZone
                side="left"
                onClick={() => dispatch({ type: "set_current_room", room: currentRoom - 1 })}
                onDragOverChange={(over) => setLeftDoorDragOver(over)}
                onDrop={(deskIndex) => {
                  const a = roomAgents.find((a) => a.desk === deskIndex);
                  if (!a) {
                    setLeftDoorReject(true);
                    setTimeout(() => setLeftDoorReject(false), 400);
                    return false;
                  }
                  const targetRoom = currentRoom - 1;
                  const targetRoomId = rooms[targetRoom]?.id;
                  if (!targetRoomId || agents.filter((x) => x.room === targetRoom).length >= 8) {
                    setLeftDoorReject(true);
                    setTimeout(() => setLeftDoorReject(false), 400);
                    return false;
                  }
                  send({ type: "move_agent", agentId: a.id, targetRoomId });
                  return true;
                }}
              />
            )}
            {currentRoom < roomCount - 1 && (
              <DoorDropZone
                side="right"
                onClick={() => dispatch({ type: "set_current_room", room: currentRoom + 1 })}
                onDragOverChange={(over) => setRightDoorDragOver(over)}
                onDrop={(deskIndex) => {
                  const a = roomAgents.find((a) => a.desk === deskIndex);
                  if (!a) {
                    setRightDoorReject(true);
                    setTimeout(() => setRightDoorReject(false), 400);
                    return false;
                  }
                  const targetRoom = currentRoom + 1;
                  const targetRoomId = rooms[targetRoom]?.id;
                  if (!targetRoomId || agents.filter((x) => x.room === targetRoom).length >= 8) {
                    setRightDoorReject(true);
                    setTimeout(() => setRightDoorReject(false), 400);
                    return false;
                  }
                  send({ type: "move_agent", agentId: a.id, targetRoomId });
                  return true;
                }}
              />
            )}
            {Array.from({ length: 8 }, (_, i) => {
              const agent = roomAgents.find((a) => a.desk === i);
              if (agent) {
                return (
                  <DeskUnit
                    key={agent.id}
                    agent={agent}
                    onClick={() => dispatch({ type: "focus", agentId: agent.id })}
                    onContextMenu={(e) => onContextMenu(e.clientX, e.clientY, agent)}
                    needsAttention={needsAttention.has(agent.id)}
                    onSwap={(a, b) => {
                      const rid = rooms[currentRoom]?.id;
                      if (rid) send({ type: "swap_desks", deskA: a, deskB: b, roomId: rid });
                    }}
                    stateChangedAt={stateChangedAt.get(agent.id)}
                  />
                );
              }
              return (
                <EmptySlot
                  key={`empty-${i}`}
                  deskIndex={i}
                  onClick={() => onSpawn(i)}
                  onSwap={(a, b) => {
                    const rid = rooms[currentRoom]?.id;
                    if (rid) send({ type: "swap_desks", deskA: a, deskB: b, roomId: rid });
                  }}
                />
              );
            })}
            {/* Two layers, two stable per-connection keys per layer. The body
                and tag layers are independent React siblings, each iterating
                placements in connectionId order. Body/tag never interleave in
                the DOM, so a new arrival's body insertion can't shift an
                existing ghost's tag (or vice versa). Combined with the
                connectionId-sorted output from useGhostTransitions, no
                existing ghost's DOM node moves when an unrelated anchor
                changes — which keeps CSS transitions intact and prevents
                browsers from re-attach-restarting any inline animations. */}
            {ghostPlacements.map((p) => (
              <GhostBody
                key={`body-${p.presence.connectionId}`}
                left={p.left}
                top={p.top}
                size={GHOST_SIZE}
                variant={p.presence.avatarVariant}
                color={p.presence.avatarColor}
                username={p.presence.username}
                device={p.presence.device}
                userId={p.presence.userId}
                dimmed={p.dimmed}
                onClick={onOpenUserSettingsForUser}
              />
            ))}
            {ghostPlacements.map((p) => (
              <GhostTag
                key={`tag-${p.presence.connectionId}`}
                left={p.left}
                top={p.top}
                size={GHOST_SIZE}
                variant={p.presence.avatarVariant}
                color={p.presence.avatarColor}
                username={p.presence.username}
                device={p.presence.device}
                userId={p.presence.userId}
                dimmed={p.dimmed}
                onClick={onOpenUserSettingsForUser}
              />
            ))}
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
      <ThemePicker open={themePickerOpen} onClose={() => setThemePickerOpen(false)} />
    </div>
  );
}
