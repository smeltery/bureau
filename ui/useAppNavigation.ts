import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { AgentInfo, RoomWire, SessionContext } from "../shared/types.ts";
import type { Action } from "./store.tsx";
import { send } from "./ws.ts";
import { getDevice } from "./device-settings.ts";
import { shouldHostCloseOnEscape } from "./components/modals/expandedEditorState.ts";
import type { ViewportControls } from "./office/OfficeView.tsx";
import { pageForPath, pathForPage, type Page } from "./routes.ts";

function pageFromFlags(flags: { tasksOpen: boolean; cronjobsOpen: boolean; appsOpen: boolean; pluginsOpen: boolean; settingsOpen: boolean }): Page | null {
  if (flags.settingsOpen) return "settings";
  if (flags.tasksOpen) return "tasks";
  if (flags.cronjobsOpen) return "schedules";
  if (flags.appsOpen) return "apps";
  if (flags.pluginsOpen) return "plugins";
  return null;
}

type ViewMode = "office" | "log" | "away";

/** Cycle to the next/previous agent in the current room, matching Tab/Shift+Tab logic. */
export function cycleAgent(agents: AgentInfo[], drafts: Map<string, string>, currentRoom: number, focusedAgentId: string | null, direction: "next" | "prev"): string | null {
  const roomAgents = agents.filter((agent) => agent.room === currentRoom);
  const sorted = [...roomAgents].sort((a, b) => a.desk - b.desk);
  const nonIdle = sorted.filter((agent) => (agent.state !== "idle" && agent.state !== "stopped") || (drafts.get(agent.id) ?? "").length > 0);
  const pool = nonIdle.length > 0 ? nonIdle : sorted;
  if (pool.length === 0) return null;
  const idx = pool.findIndex((agent) => agent.id === focusedAgentId);
  if (idx !== -1 && pool.length <= 1) return null;
  const next = idx === -1 ? (direction === "prev" ? pool[pool.length - 1] : pool[0]) : direction === "prev" ? pool[(idx - 1 + pool.length) % pool.length] : pool[(idx + 1) % pool.length];
  return next.id;
}

function sendClaim(username: string) {
  send({ type: "claim_user", username });
}

export function useAppNavigation({
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
  appsOpen,
  pluginsOpen,
  anyModalOpen,
  setTasksOpen,
  setCronjobsOpen,
  setAppsOpen,
  setPluginsOpen,
  setSpawnDesk,
  setCtxMenu,
  setEditAgent,
  settingsOpen,
  openSettings,
  closeSettings,
  bootPage,
}: {
  agents: AgentInfo[];
  connected: boolean;
  currentRoom: number;
  dispatch: Dispatch<Action>;
  drafts: Map<string, string>;
  focusedAgent: AgentInfo | null;
  focusedAgentId: string | null;
  sessionContext: SessionContext | null;
  rooms: RoomWire[];
  username: string | null;
  tasksOpen: boolean;
  cronjobsOpen: boolean;
  appsOpen: boolean;
  pluginsOpen: boolean;
  anyModalOpen: boolean;
  setTasksOpen: Dispatch<SetStateAction<boolean>>;
  setCronjobsOpen: Dispatch<SetStateAction<boolean>>;
  setAppsOpen: Dispatch<SetStateAction<boolean>>;
  setPluginsOpen: Dispatch<SetStateAction<boolean>>;
  setSpawnDesk: Dispatch<SetStateAction<number | null>>;
  setCtxMenu: Dispatch<SetStateAction<{ x: number; y: number; agent: AgentInfo } | null>>;
  setEditAgent: Dispatch<SetStateAction<AgentInfo | null>>;
  settingsOpen: boolean;
  openSettings: () => void;
  closeSettings: () => void;
  /** Panel named by the load URL, or null for office / unknown paths. */
  bootPage: Page | null;
}) {
  const roomCount = rooms.length;
  const viewportControlsRef = useRef<ViewportControls | null>(null);
  // History ownership for the current entry (isomux ruling 8):
  // none = office on the load entry; adopted = cold deep link we did not push;
  // pushed = we pushed the entry, so Close/Escape may history.back().
  const entryRef = useRef<"none" | "adopted" | "pushed">(bootPage === null ? "none" : "adopted");

  useEffect(() => {
    if (username && connected) sendClaim(username);
  }, [username, connected]);

  const viewMode: ViewMode = tasksOpen || cronjobsOpen || appsOpen || pluginsOpen || anyModalOpen ? "away" : focusedAgentId ? "log" : "office";
  const presenceRoom = focusedAgent?.room ?? currentRoom;
  const presenceRoomId = focusedAgent?.roomId ?? rooms[presenceRoom]?.id ?? null;
  useEffect(() => {
    if (!sessionContext) return;
    send({ type: "presence_update", currentRoom: presenceRoom, currentRoomId: presenceRoomId, focusedAgentId, viewMode, device: getDevice() });
  }, [sessionContext, presenceRoom, presenceRoomId, focusedAgentId, viewMode]);

  const swipeRoomNext = useCallback(() => {
    if (roomCount <= 1) return;
    dispatch({ type: "set_current_room", room: (currentRoom + 1) % roomCount });
  }, [dispatch, currentRoom, roomCount]);

  const swipeRoomPrev = useCallback(() => {
    if (roomCount <= 1) return;
    dispatch({ type: "set_current_room", room: (currentRoom - 1 + roomCount) % roomCount });
  }, [dispatch, currentRoom, roomCount]);

  const swipeAgentNext = useCallback(() => {
    const nextId = cycleAgent(agents, drafts, currentRoom, focusedAgentId, "next");
    if (nextId) dispatch({ type: "focus", agentId: nextId });
  }, [dispatch, agents, drafts, currentRoom, focusedAgentId]);

  const swipeAgentPrev = useCallback(() => {
    const nextId = cycleAgent(agents, drafts, currentRoom, focusedAgentId, "prev");
    if (nextId) dispatch({ type: "focus", agentId: nextId });
  }, [dispatch, agents, drafts, currentRoom, focusedAgentId]);

  const applyPage = useCallback(
    (page: Page | null) => {
      setTasksOpen(page === "tasks");
      setCronjobsOpen(page === "schedules");
      setAppsOpen(page === "apps");
      setPluginsOpen(page === "plugins");
      if (page === "settings") openSettings();
      else closeSettings();
    },
    [closeSettings, openSettings, setAppsOpen, setCronjobsOpen, setPluginsOpen, setTasksOpen],
  );

  const goHome = useCallback(() => {
    if (entryRef.current === "pushed") {
      window.history.back(); // popstate resets panel/focus state
      return;
    }
    // Cold deep link: nothing underneath — replace in place so Close still works.
    if (entryRef.current === "adopted") {
      window.history.replaceState({ bureau: true, page: null }, "", "/");
    }
    entryRef.current = "none";
    applyPage(null);
    dispatch({ type: "focus", agentId: null });
  }, [applyPage, dispatch]);

  // Tasks opened over a focused chat: closing the board returns to that chat
  // (still deep). Otherwise Close returns to the office.
  const tasksOverChat = tasksOpen && !!focusedAgent;
  const closeTasks = useCallback(() => {
    if (tasksOverChat) setTasksOpen(false);
    else goHome();
  }, [goHome, setTasksOpen, tasksOverChat]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || !!target?.isContentEditable;
      // This is the global fallback: it closes views and clears the spawn /
      // context-menu / edit-agent slots. An expanded editor (ExpandableTextarea)
      // stops Escape from reaching us at all, but check anyway — this handler
      // discards a whole dialog's worth of unsaved form state, so it must never
      // be the thing that fires when the user only meant to collapse an editor.
      if (shouldHostCloseOnEscape(e)) {
        goHome();
        setSpawnDesk(null);
        setCtxMenu(null);
        setEditAgent(null);
      }

      const viewport = viewportControlsRef.current;
      if (viewport && !isInput && !focusedAgentId && !e.metaKey && !e.ctrlKey && !e.altKey) {
        if (e.key === "0") {
          e.preventDefault();
          viewport.resetView();
        } else if (e.key === "+" || e.key === "=") {
          e.preventDefault();
          viewport.zoomIn();
        } else if (e.key === "-") {
          e.preventDefault();
          viewport.zoomOut();
        }
      }

      if (!isInput && !focusedAgentId && e.key >= "1" && e.key <= "8" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const deskIndex = parseInt(e.key) - 1;
        const agent = agents.find((candidate) => candidate.desk === deskIndex && candidate.room === currentRoom);
        if (agent) {
          e.preventDefault();
          dispatch({ type: "focus", agentId: agent.id });
        }
      }

      // "t": toggle the task board from office or agent chat, unless Settings is
      // open (jumping away would skip unsaved-edit checks on that page).
      if (!isInput && e.key === "t" && !settingsOpen && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        setTasksOpen((open) => !open);
      }

      // "a": toggle Apps from office or agent chat, unless Settings is open.
      if (!isInput && e.key === "a" && !settingsOpen && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        if (appsOpen && !tasksOpen && !cronjobsOpen && !pluginsOpen) goHome();
        else {
          setTasksOpen(false);
          setCronjobsOpen(false);
          setPluginsOpen(false);
          setAppsOpen(true);
        }
      }

      // "s": open Settings. Only opens — Escape (via the page) is the way out so
      // we never skip its unsaved-edits check by toggling closed here.
      if (!isInput && e.key === "s" && !settingsOpen && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        openSettings();
      }

      if (!isInput && !focusedAgentId && e.key === "Tab" && roomCount > 1 && !e.defaultPrevented) {
        e.preventDefault();
        const next = e.shiftKey ? (currentRoom - 1 + roomCount) % roomCount : (currentRoom + 1) % roomCount;
        dispatch({ type: "set_current_room", room: next });
      }

      if (focusedAgentId && e.key === "Tab" && agents.length > 1 && !e.defaultPrevented) {
        e.preventDefault();
        const nextId = cycleAgent(agents, drafts, currentRoom, focusedAgentId, e.shiftKey ? "prev" : "next");
        if (nextId) dispatch({ type: "focus", agentId: nextId });
      }
    }

    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [
    appsOpen,
    cronjobsOpen,
    dispatch,
    goHome,
    focusedAgentId,
    agents,
    drafts,
    currentRoom,
    pluginsOpen,
    roomCount,
    setAppsOpen,
    setCronjobsOpen,
    setCtxMenu,
    setEditAgent,
    setPluginsOpen,
    setSpawnDesk,
    setTasksOpen,
    tasksOpen,
    settingsOpen,
    openSettings,
  ]);

  // Agent chats are not routes — they share "/" with the office. Panels get
  // real paths so refresh/share keep working.
  const page = pageFromFlags({ tasksOpen, cronjobsOpen, appsOpen, pluginsOpen, settingsOpen });
  const isDeep = page !== null || focusedAgentId !== null;
  useEffect(() => {
    const entry = { bureau: true, page };
    const path = pathForPage(page);
    if (isDeep && entryRef.current === "none") {
      window.history.pushState(entry, "", path);
      entryRef.current = "pushed";
    } else if (isDeep) {
      // Deep→deep, or boot on an adopted entry: rewrite path in place
      // (canonicalises /cronjobs → /schedules, /users → /settings).
      window.history.replaceState(entry, "", path);
    } else if (entryRef.current !== "none") {
      // Returned to office without history.back() (e.g. "t" toggle): keep the
      // stack entry but point it at the office so the address bar matches.
      window.history.replaceState({ bureau: true, page: null }, "", "/");
      entryRef.current = "none";
    }
  }, [isDeep, page]);

  // Non-route paths show the office — normalise the address bar to "/".
  useEffect(() => {
    if (bootPage !== null || window.location.pathname === "/") return;
    window.history.replaceState({ bureau: true, page: null }, "", "/");
  }, [bootPage]);

  useEffect(() => {
    function handlePopState() {
      const target = pageForPath(window.location.pathname);
      if (target !== null) {
        if (entryRef.current === "none") entryRef.current = "pushed";
        applyPage(target);
        return;
      }
      entryRef.current = "none";
      if (tasksOverChat) {
        // Back from tasks-over-chat steps to the chat, not the office.
        setTasksOpen(false);
        return;
      }
      applyPage(null);
      dispatch({ type: "focus", agentId: null });
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [applyPage, dispatch, setTasksOpen, tasksOverChat]);

  return {
    goHome,
    closeTasks,
    swipeAgentNext,
    swipeAgentPrev,
    swipeRoomNext,
    swipeRoomPrev,
    viewportControlsRef,
  };
}
