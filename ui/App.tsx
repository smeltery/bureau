import { useEffect, useRef, useState } from "react";
import { useAppState, useDispatch } from "./store.tsx";
import { OfficeView } from "./office/OfficeView.tsx";
import { LogView } from "./log-view/LogView.tsx";
import { AgentListView } from "./components/overlays/AgentListView.tsx";
import { ContextMenu } from "./components/overlays/ContextMenu.tsx";
import { EditAgentDialog } from "./components/modals/EditAgentDialog.tsx";
import { EngineChooserDialog } from "./components/modals/EngineChooserDialog.tsx";
import { UserManagementModal } from "./components/modals/UserManagementModal.tsx";
import { UserSettingsView } from "./components/UserSettingsView.tsx";
import { DeviceSettingsModal } from "./components/modals/DeviceSettingsModal.tsx";
import { OfficePromptModal } from "./components/modals/OfficePromptModal.tsx";
import { RoomSettingsModal } from "./components/modals/RoomSettingsModal.tsx";
import { TaskView } from "./task-view/TaskView.tsx";
import { CronjobsView } from "./components/CronjobsView.tsx";
import { PluginsView } from "./components/PluginsView.tsx";
import { UpdateModal } from "./components/modals/UpdateModal.tsx";
import { ConnectionBanner } from "./components/ConnectionBanner.tsx";
import { CSS } from "./styles.ts";
import type { AgentBackendType, AgentInfo } from "../shared/types.ts";
import { useAppNavigation } from "./useAppNavigation.ts";
import { storageGetItem, storageSetItem } from "./browser-storage.ts";
import { normalizeDraftUser, pruneDraftsForUser, readDraftsForUser, writeDraftForUser } from "./store-drafts.ts";
import { readSavedView, writeSavedView } from "./store-view.ts";
import { agentTabLabel } from "./agent-tab-label.ts";

export function App() {
  const { agents, logs, focusedAgentId, isMobile, mobileViewMode, drafts, currentRoom, rooms, connected, sessionContext, hasReceivedInitialState } = useAppState();
  const dispatch = useDispatch();
  const restoredDraftUserRef = useRef<string | null>(null);
  const restoredViewUserRef = useRef<string | null>(null);
  const hasRestoredViewRef = useRef(false);
  const persistedDraftsRef = useRef<Map<string, string>>(new Map());
  const [spawnDesk, setSpawnDesk] = useState<number | null>(null);
  const [spawnAgentType, setSpawnAgentType] = useState<AgentBackendType | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; agent: AgentInfo } | null>(null);
  const [editAgent, setEditAgent] = useState<AgentInfo | null>(null);
  const [username, setUsername] = useState<string | null>(() => storageGetItem("bureau-username"));
  const [editingUsername, setEditingUsername] = useState(false);
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editingDeviceSettings, setEditingDeviceSettings] = useState(false);
  const [editingOfficePrompt, setEditingOfficePrompt] = useState(false);
  const [editingRoomSettings, setEditingRoomSettings] = useState<string | null>(null);
  const [tasksOpen, setTasksOpen] = useState(false);
  const [cronjobsOpen, setCronjobsOpen] = useState(false);
  const [pluginsOpen, setPluginsOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);

  const focusedAgent = focusedAgentId ? (agents.find((a) => a.id === focusedAgentId) ?? null) : null;
  const anyModalOpen = editingUsername || editingDeviceSettings || editingOfficePrompt || editingRoomSettings !== null || updateOpen;
  const draftUser = normalizeDraftUser(sessionContext?.username ?? username);

  useEffect(() => {
    if (!hasReceivedInitialState || !draftUser || restoredDraftUserRef.current === draftUser) return;
    const liveAgentIds = new Set(agents.map((agent) => agent.id));
    const restoredDrafts = readDraftsForUser(draftUser, liveAgentIds);
    restoredDrafts.forEach((text, agentId) => dispatch({ type: "set_draft", agentId, text }));
    pruneDraftsForUser(draftUser, liveAgentIds);
    persistedDraftsRef.current = new Map(drafts);
    restoredDraftUserRef.current = draftUser;
  }, [agents, dispatch, draftUser, drafts, hasReceivedInitialState]);

  useEffect(() => {
    if (!draftUser || restoredDraftUserRef.current !== draftUser) return;
    const previousDrafts = persistedDraftsRef.current;

    drafts.forEach((text, agentId) => {
      if (previousDrafts.get(agentId) !== text) writeDraftForUser(draftUser, agentId, text);
    });

    previousDrafts.forEach((_text, agentId) => {
      if (!drafts.has(agentId)) writeDraftForUser(draftUser, agentId, "");
    });

    persistedDraftsRef.current = new Map(drafts);
  }, [draftUser, drafts]);

  useEffect(() => {
    if (!hasReceivedInitialState || !draftUser || restoredViewUserRef.current === draftUser) return;
    const saved = readSavedView(draftUser);
    restoredViewUserRef.current = draftUser;
    hasRestoredViewRef.current = true;
    if (!saved) return;

    const roomIndex = saved.roomId ? rooms.findIndex((room) => room.id === saved.roomId) : -1;
    const agent = saved.agentId ? agents.find((candidate) => candidate.id === saved.agentId) : null;
    if (roomIndex >= 0) dispatch({ type: "set_current_room", room: roomIndex });
    if (agent) dispatch({ type: "focus", agentId: agent.id });
    if (saved.panel === "tasks") setTasksOpen(true);
    else if (saved.panel === "cronjobs") setCronjobsOpen(true);
    else if (saved.panel === "plugins") setPluginsOpen(true);
  }, [agents, dispatch, draftUser, hasReceivedInitialState, rooms]);

  useEffect(() => {
    if (!draftUser || !hasRestoredViewRef.current) return;
    const focused = focusedAgentId ? (agents.find((agent) => agent.id === focusedAgentId) ?? null) : null;
    const roomId = focused?.roomId ?? rooms[currentRoom]?.id ?? null;
    const panel = tasksOpen ? "tasks" : cronjobsOpen ? "cronjobs" : pluginsOpen ? "plugins" : null;
    writeSavedView(draftUser, { roomId, agentId: focusedAgentId, panel });
  }, [agents, cronjobsOpen, currentRoom, draftUser, focusedAgentId, pluginsOpen, rooms, tasksOpen]);

  const focusedAgentName = focusedAgent?.name ?? null;
  const focusedAgentState = focusedAgent?.state ?? null;
  const currentRoomName = rooms[currentRoom]?.name ?? null;
  useEffect(() => {
    if (!connected) return;
    const panelTitle = tasksOpen ? "Tasks" : cronjobsOpen ? "Cron Jobs" : pluginsOpen ? "Plugins" : null;
    const focusedAgentTitle = focusedAgentName && focusedAgentState ? agentTabLabel(focusedAgentName, focusedAgentState) : null;
    const label = panelTitle ?? focusedAgentTitle ?? currentRoomName ?? null;
    document.title = label ? `${label} | Bureau` : "Bureau";
  }, [connected, cronjobsOpen, currentRoomName, focusedAgentName, focusedAgentState, pluginsOpen, tasksOpen]);

  const { goHome, swipeAgentNext, swipeAgentPrev, swipeRoomNext, swipeRoomPrev, viewportControlsRef } = useAppNavigation({
    agents,
    connected,
    currentRoom,
    dispatch,
    drafts,
    focusedAgent,
    focusedAgentId,
    sessionContext,
    rooms,
    username,
    tasksOpen,
    cronjobsOpen,
    pluginsOpen,
    anyModalOpen,
    setTasksOpen,
    setCronjobsOpen,
    setPluginsOpen,
    setSpawnDesk,
    setCtxMenu,
    setEditAgent,
  });

  return (
    <>
      <style>{CSS}</style>
      <ConnectionBanner />
      {username === null && <UserManagementModal currentUsername={null} forceCreate onSwitchUser={setUsername} />}
      {editingUsername && username !== null ? (
        <UserSettingsView
          currentUsername={username}
          initialUserId={editingUserId}
          onSwitchUser={setUsername}
          onClose={() => {
            setEditingUsername(false);
            setEditingUserId(null);
          }}
        />
      ) : pluginsOpen ? (
        <PluginsView onClose={goHome} />
      ) : cronjobsOpen ? (
        <CronjobsView username={username ?? ""} onClose={goHome} />
      ) : tasksOpen ? (
        <TaskView
          username={username ?? ""}
          onClose={goHome}
          onFocusAgent={(agentId) => {
            setTasksOpen(false);
            dispatch({ type: "focus", agentId });
          }}
        />
      ) : focusedAgent ? (
        <LogView
          key={focusedAgent.id}
          agent={focusedAgent}
          logs={logs.get(focusedAgent.id) ?? []}
          onBack={goHome}
          onEditAgent={() => setEditAgent(focusedAgent)}
          username={username ?? ""}
          onOpenTasks={() => setTasksOpen(true)}
          onSwipeLeft={swipeAgentNext}
          onSwipeRight={swipeAgentPrev}
        />
      ) : isMobile && mobileViewMode === "list" ? (
        <AgentListView
          onFocus={(agentId) => dispatch({ type: "focus", agentId })}
          onSpawn={() => setSpawnDesk(0)}
          onContextMenu={(x, y, agent) => setCtxMenu({ x, y, agent })}
          username={username ?? ""}
          onEditUsername={() => setEditingUsername(true)}
          onOpenDeviceSettings={() => setEditingDeviceSettings(true)}
          onEditOfficePrompt={() => setEditingOfficePrompt(true)}
          onEditRoomSettings={() => {
            const rid = rooms[currentRoom]?.id;
            if (rid) setEditingRoomSettings(rid);
          }}
          onOpenTasks={() => setTasksOpen(true)}
          onOpenCronjobs={() => setCronjobsOpen(true)}
          onOpenUpdate={() => setUpdateOpen(true)}
          onToggleView={() => dispatch({ type: "toggle_mobile_view" })}
          onSwipeLeft={swipeRoomNext}
          onSwipeRight={swipeRoomPrev}
        />
      ) : (
        <OfficeView
          onSpawn={(desk) => setSpawnDesk(desk)}
          onContextMenu={(x, y, agent) => setCtxMenu({ x, y, agent })}
          username={username ?? ""}
          onEditUsername={() => setEditingUsername(true)}
          onOpenUserSettingsForUser={(userId) => {
            setEditingUserId(userId);
            setEditingUsername(true);
          }}
          onOpenDeviceSettings={() => setEditingDeviceSettings(true)}
          onEditOfficePrompt={() => setEditingOfficePrompt(true)}
          onEditRoomSettings={() => {
            const rid = rooms[currentRoom]?.id;
            if (rid) setEditingRoomSettings(rid);
          }}
          onOpenTasks={() => setTasksOpen(true)}
          onOpenCronjobs={() => setCronjobsOpen(true)}
          onOpenPlugins={() => setPluginsOpen(true)}
          onOpenUpdate={() => setUpdateOpen(true)}
          onSwipeLeft={swipeRoomNext}
          onSwipeRight={swipeRoomPrev}
          viewportControlsRef={viewportControlsRef}
        />
      )}
      {spawnDesk !== null && spawnAgentType === null && rooms[currentRoom] && (
        <EngineChooserDialog deskIndex={spawnDesk} roomId={rooms[currentRoom].id} onPick={(agentType) => setSpawnAgentType(agentType)} onCancel={() => setSpawnDesk(null)} />
      )}
      {spawnDesk !== null && spawnAgentType !== null && (
        <EditAgentDialog
          deskIndex={spawnDesk}
          defaultCwd="~"
          agentType={spawnAgentType}
          onClose={() => {
            setSpawnDesk(null);
            setSpawnAgentType(null);
          }}
          room={currentRoom}
        />
      )}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          agent={ctxMenu.agent}
          onClose={() => setCtxMenu(null)}
          onEdit={(agent) => {
            setEditAgent(agent);
            setCtxMenu(null);
          }}
        />
      )}
      {editAgent && <EditAgentDialog agent={editAgent} onClose={() => setEditAgent(null)} />}
      {editingOfficePrompt && (
        <OfficePromptModal
          onClose={() => setEditingOfficePrompt(false)}
          username={username ?? ""}
          onSaveUsername={(name) => {
            storageSetItem("bureau-username", name);
            setUsername(name);
          }}
        />
      )}
      {editingDeviceSettings && <DeviceSettingsModal onClose={() => setEditingDeviceSettings(false)} />}
      {editingRoomSettings && <RoomSettingsModal roomId={editingRoomSettings} onClose={() => setEditingRoomSettings(null)} />}
      {updateOpen && <UpdateModal onClose={() => setUpdateOpen(false)} />}
    </>
  );
}
