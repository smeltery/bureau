import { useCallback, useEffect, useState, type ReactNode } from "react";
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
import { SunIcon, MoonIcon } from "../components/controls/Icons.tsx";
import { ThemePicker } from "../components/ThemePicker.tsx";
import { MobileHeader, getRoomCounts } from "../components/overlays/MobileHeader.tsx";
import { WallPanelMenu, type WallPanelMenuItem } from "../components/overlays/WallPanelMenu.tsx";
import { useSwipeLeftRight } from "../hooks/useSwipeLeftRight.ts";
import { useViewport } from "./useViewport.ts";
import { ZoomControls } from "./ZoomControls.tsx";
import type { AgentInfo } from "../../shared/types.ts";

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

function BuildingIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="3" y="2" width="10" height="13" />
      <line x1="6" y1="5" x2="6" y2="6" />
      <line x1="10" y1="5" x2="10" y2="6" />
      <line x1="6" y1="9" x2="6" y2="10" />
      <line x1="10" y1="9" x2="10" y2="10" />
      <line x1="7" y1="13" x2="9" y2="13" />
    </svg>
  );
}

function DoorIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
      <rect x="4" y="2" width="8" height="13" />
      <circle cx="10" cy="9" r="0.6" fill="currentColor" />
    </svg>
  );
}

function TasksIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 4.5l1.3 1.3L6.8 3.3" />
      <path d="M3 8.5l1.3 1.3L6.8 7.3" />
      <path d="M9 4.5h4.5M9 8.5h4.5M3 12.5h10.5" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="6" />
      <path d="M8 4.5V8l2.5 1.5" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
      <circle cx="8" cy="5" r="2.3" />
      <path d="M3.5 13c.7-2.4 2.2-3.6 4.5-3.6s3.8 1.2 4.5 3.6" />
    </svg>
  );
}

function DeviceIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
      <rect x="5" y="1.5" width="6" height="13" rx="1.2" />
      <path d="M7.4 12.2h1.2" />
    </svg>
  );
}

function HeaderButton({ icon, label, title, onClick }: { icon: ReactNode; label: string; title?: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "7px 13px",
        borderRadius: 8,
        border: "1px solid var(--border-medium)",
        background: "var(--btn-surface)",
        color: "var(--text-dim)",
        fontSize: 12,
        fontWeight: 600,
        cursor: "pointer",
        whiteSpace: "nowrap",
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

/** HTML drop zone positioned over an SVG door — SVG elements are unreliable drag-and-drop targets */
function DoorDropZone({ side, onDrop, onDragOverChange, onClick }: { side: "left" | "right"; onDrop: (deskIndex: number) => boolean; onDragOverChange: (over: boolean) => void; onClick: () => void }) {
  const [reject, setReject] = useState(false);
  // Pixel positions within the 950×700 scene container, derived from the SVG door transforms
  const style: React.CSSProperties =
    side === "left" ? { position: "absolute", left: 0, top: 225, width: 85, height: 155, zIndex: 200 } : { position: "absolute", right: 0, top: 225, width: 85, height: 155, zIndex: 200 };
  return (
    <div
      data-no-pan
      style={{ ...style, cursor: "pointer", background: reject ? "rgba(255,60,60,0.08)" : "transparent" }}
      onClick={onClick}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDragEnter={() => onDragOverChange(true)}
      onDragLeave={() => onDragOverChange(false)}
      onDrop={(e) => {
        e.preventDefault();
        onDragOverChange(false);
        const src = parseInt(e.dataTransfer.getData("text/plain"), 10);
        if (!isNaN(src)) {
          const ok = onDrop(src);
          if (!ok) {
            setReject(true);
            setTimeout(() => setReject(false), 400);
          }
        }
      }}
    />
  );
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
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "minmax(0, 1fr) auto minmax(0, 1fr)",
            alignItems: "center",
            padding: "0 20px",
            height: 44,
            background: "var(--bg-hud)",
            backdropFilter: "blur(16px)",
            borderBottom: "1px solid var(--border-subtle)",
            flexShrink: 0,
            zIndex: 500,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 9, justifySelf: "start", minWidth: 0 }}>
            <span style={{ fontSize: 15, fontWeight: 700, letterSpacing: "-0.02em", color: "var(--text-primary)" }}>Bureau</span>
            {updateAvailable && (
              <span
                onClick={onOpenUpdate}
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--blue, #58a6ff)",
                  fontFamily: "'JetBrains Mono',monospace",
                  letterSpacing: "0.02em",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 5,
                }}
              >
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--blue, #58a6ff)", boxShadow: "0 0 8px var(--blue, #58a6ff)" }} />
                update available
              </span>
            )}
          </div>
          <div style={{ display: "flex", gap: 12, justifySelf: "center" }}>
            {(
              [
                { n: counts.working, c: "var(--green)", l: "working" },
                { n: counts.waiting, c: "var(--purple)", l: "waiting" },
                { n: counts.error, c: "var(--red)", l: "error" },
                { n: counts.idle, c: "var(--text-muted)", l: "idle" },
              ] as const
            )
              .filter((s) => s.n > 0)
              .map((s) => (
                <div
                  key={s.l}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 5,
                    fontSize: 10,
                    fontWeight: 600,
                    color: s.c,
                    fontFamily: "'JetBrains Mono',monospace",
                    letterSpacing: "0.02em",
                  }}
                >
                  <span
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      background: s.c,
                      boxShadow: `0 0 6px ${s.c}`,
                    }}
                  />
                  {s.n} {s.l}
                </div>
              ))}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, justifySelf: "end" }}>
            <HeaderButton icon={<TasksIcon />} label="Tasks" onClick={onOpenTasks} />
            {onOpenCronjobs && <HeaderButton icon={<ClockIcon />} label="Cron jobs" title="Cron jobs" onClick={onOpenCronjobs} />}
            <HeaderButton icon={<UserIcon />} label="User" title={username || "User settings"} onClick={onEditUsername} />
            <HeaderButton icon={<DeviceIcon />} label="Device" title="Device settings" onClick={onOpenDeviceSettings} />
            <HeaderButton icon={<BuildingIcon />} label="Office" title="Office settings" onClick={onEditOfficePrompt} />
            {onEditRoomSettings && <HeaderButton icon={<DoorIcon />} label="Room" title="Room settings" onClick={onEditRoomSettings} />}
            <HeaderButton icon={mode === "dark" ? <MoonIcon /> : <SunIcon />} label="Theme" title="Change theme" onClick={() => setThemePickerOpen(true)} />
          </div>
        </div>
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
      {!embed && (
        <div
          style={{
            padding: isMobile ? "8px 12px" : "8px 20px",
            ...(isMobile ? { paddingBottom: "calc(8px + env(safe-area-inset-bottom, 0px))" } : {}),
            background: "var(--bg-hud-bottom)",
            backdropFilter: "blur(8px)",
            borderTop: "1px solid var(--border-subtle)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: isMobile ? 12 : 20,
            flexShrink: 0,
            zIndex: 500,
          }}
        >
          {(isMobile ? ["TAP → open", "LONG-PRESS → actions"] : ["CLICK → open agent", "DRAG → swap desks or move to door", "RIGHT-CLICK → actions", "ESC → back"]).map((h, i) => (
            <span
              key={i}
              style={{
                fontSize: 9,
                color: "var(--text-hint)",
                fontFamily: "'JetBrains Mono',monospace",
                letterSpacing: "0.04em",
              }}
            >
              {h}
            </span>
          ))}
        </div>
      )}
      {wallMenu && <WallPanelMenu x={wallMenu.x} y={wallMenu.y} items={wallMenuItems} onClose={() => setWallMenu(null)} />}
      <ThemePicker open={themePickerOpen} onClose={() => setThemePickerOpen(false)} />
    </div>
  );
}
