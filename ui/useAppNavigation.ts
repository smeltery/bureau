import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { AgentInfo, RoomWire, SessionContext } from "../shared/types.ts";
import type { Action } from "./store.tsx";
import { send } from "./ws.ts";
import { getDevice } from "./device-settings.ts";
import type { ViewportControls } from "./office/OfficeView.tsx";

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
  pluginsOpen,
  anyModalOpen,
  setTasksOpen,
  setCronjobsOpen,
  setPluginsOpen,
  setSpawnDesk,
  setCtxMenu,
  setEditAgent,
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
  pluginsOpen: boolean;
  anyModalOpen: boolean;
  setTasksOpen: Dispatch<SetStateAction<boolean>>;
  setCronjobsOpen: Dispatch<SetStateAction<boolean>>;
  setPluginsOpen: Dispatch<SetStateAction<boolean>>;
  setSpawnDesk: Dispatch<SetStateAction<number | null>>;
  setCtxMenu: Dispatch<SetStateAction<{ x: number; y: number; agent: AgentInfo } | null>>;
  setEditAgent: Dispatch<SetStateAction<AgentInfo | null>>;
}) {
  const roomCount = rooms.length;
  const viewportControlsRef = useRef<ViewportControls | null>(null);

  useEffect(() => {
    if (username && connected) sendClaim(username);
  }, [username, connected]);

  const viewMode: ViewMode = tasksOpen || cronjobsOpen || pluginsOpen || anyModalOpen ? "away" : focusedAgentId ? "log" : "office";
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

  const deepRef = useRef(false);
  const goHome = useCallback(() => {
    if (deepRef.current) {
      window.history.back();
    } else {
      setTasksOpen(false);
      setCronjobsOpen(false);
      setPluginsOpen(false);
      dispatch({ type: "focus", agentId: null });
    }
  }, [dispatch, setCronjobsOpen, setPluginsOpen, setTasksOpen]);

  useEffect(() => {
    function handleKey(e: KeyboardEvent) {
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      const isInput = tag === "INPUT" || tag === "TEXTAREA" || !!target?.isContentEditable;
      if (e.key === "Escape") {
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
  }, [dispatch, goHome, focusedAgentId, agents, drafts, currentRoom, roomCount, setCtxMenu, setEditAgent, setSpawnDesk]);

  const isDeep = tasksOpen || cronjobsOpen || pluginsOpen || focusedAgentId !== null;
  useEffect(() => {
    if (isDeep && !deepRef.current) {
      window.history.pushState({ bureau: true }, "");
      deepRef.current = true;
    } else if (isDeep && deepRef.current) {
      window.history.replaceState({ bureau: true }, "");
    } else if (!isDeep && deepRef.current) {
      deepRef.current = false;
    }
  }, [isDeep]);

  useEffect(() => {
    function handlePopState() {
      deepRef.current = false;
      setTasksOpen(false);
      setCronjobsOpen(false);
      setPluginsOpen(false);
      dispatch({ type: "focus", agentId: null });
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, [dispatch, setCronjobsOpen, setPluginsOpen, setTasksOpen]);

  return {
    goHome,
    swipeAgentNext,
    swipeAgentPrev,
    swipeRoomNext,
    swipeRoomPrev,
    viewportControlsRef,
  };
}
