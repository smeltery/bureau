import { useCallback, useEffect, useRef, type Dispatch, type SetStateAction } from "react";
import type { AgentInfo, RoomWire, SessionContext } from "../shared/types.ts";
import { LOBBY_ROOM_ID } from "../shared/lobby.ts";
import type { Action } from "./store.tsx";
import { send } from "./ws.ts";
import { getDevice } from "./device-settings.ts";
import { shouldHostCloseOnEscape } from "./components/modals/expandedEditorState.ts";
import type { ViewportControls } from "./office/OfficeView.tsx";
import { pageForPath, pathForPage, type Page } from "./routes.ts";
import { cycleAgent, pageFromFlags } from "./navigation-helpers.ts";

export { cycleAgent } from "./navigation-helpers.ts";

type ViewMode = "office" | "log" | "away";

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
  lobbyOpen,
  username,
  tasksOpen,
  cronjobsOpen,
  appsOpen,
  skillsOpen,
  pluginsOpen,
  teamChatOpen,
  anyModalOpen,
  setTasksOpen,
  setCronjobsOpen,
  setAppsOpen,
  setSkillsOpen,
  setPluginsOpen,
  setTeamChatOpen,
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
  lobbyOpen: boolean;
  username: string | null;
  tasksOpen: boolean;
  cronjobsOpen: boolean;
  appsOpen: boolean;
  skillsOpen: boolean;
  pluginsOpen: boolean;
  teamChatOpen: boolean;
  anyModalOpen: boolean;
  setTasksOpen: Dispatch<SetStateAction<boolean>>;
  setCronjobsOpen: Dispatch<SetStateAction<boolean>>;
  setAppsOpen: Dispatch<SetStateAction<boolean>>;
  setSkillsOpen: Dispatch<SetStateAction<boolean>>;
  setPluginsOpen: Dispatch<SetStateAction<boolean>>;
  setTeamChatOpen: Dispatch<SetStateAction<boolean>>;
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
  // Close goes back only when this hook pushed the current history entry.
  const entryRef = useRef<"none" | "adopted" | "pushed">(bootPage === null ? "none" : "adopted");

  useEffect(() => {
    if (username && connected) sendClaim(username);
  }, [username, connected]);

  const viewMode: ViewMode = tasksOpen || cronjobsOpen || appsOpen || skillsOpen || pluginsOpen || teamChatOpen || anyModalOpen ? "away" : focusedAgentId ? "log" : "office";
  const presenceRoom = lobbyOpen ? null : (focusedAgent?.room ?? currentRoom);
  const presenceRoomId = lobbyOpen ? LOBBY_ROOM_ID : (focusedAgent?.roomId ?? rooms[presenceRoom ?? 0]?.id ?? null);
  useEffect(() => {
    if (!sessionContext) return;
    send({ type: "presence_update", currentRoom: presenceRoom, currentRoomId: presenceRoomId, focusedAgentId: lobbyOpen ? null : focusedAgentId, viewMode, device: getDevice() });
  }, [sessionContext, presenceRoom, presenceRoomId, focusedAgentId, viewMode, lobbyOpen]);

  const swipeRoomNext = useCallback(() => {
    if (lobbyOpen) {
      if (roomCount > 0) dispatch({ type: "set_current_room", room: 0 });
      return;
    }
    if (currentRoom >= roomCount - 1) {
      dispatch({ type: "set_lobby_open", open: true });
      return;
    }
    dispatch({ type: "set_current_room", room: currentRoom + 1 });
  }, [dispatch, currentRoom, roomCount, lobbyOpen]);

  const swipeRoomPrev = useCallback(() => {
    if (lobbyOpen) {
      if (roomCount > 0) dispatch({ type: "set_current_room", room: roomCount - 1 });
      return;
    }
    if (currentRoom <= 0) {
      dispatch({ type: "set_lobby_open", open: true });
      return;
    }
    dispatch({ type: "set_current_room", room: currentRoom - 1 });
  }, [dispatch, currentRoom, roomCount, lobbyOpen]);

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
      setSkillsOpen(page === "skills");
      setPluginsOpen(page === "plugins");
      setTeamChatOpen(page === "team-chat");
      if (page === "settings") openSettings();
      else closeSettings();
    },
    [closeSettings, openSettings, setAppsOpen, setCronjobsOpen, setSkillsOpen, setPluginsOpen, setTasksOpen, setTeamChatOpen],
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
      // Expanded editors consume Escape before this global navigation handler.
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
        if (appsOpen && !tasksOpen && !cronjobsOpen && !skillsOpen && !pluginsOpen && !teamChatOpen) goHome();
        else {
          setTasksOpen(false);
          setCronjobsOpen(false);
          setSkillsOpen(false);
          setPluginsOpen(false);
          setTeamChatOpen(false);
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
    skillsOpen,
    pluginsOpen,
    roomCount,
    setAppsOpen,
    setCronjobsOpen,
    setCtxMenu,
    setEditAgent,
    setSkillsOpen,
    setPluginsOpen,
    setSpawnDesk,
    setTasksOpen,
    setTeamChatOpen,
    tasksOpen,
    teamChatOpen,
    settingsOpen,
    openSettings,
  ]);

  // Agent chats are not routes — they share "/" with the office. Panels get
  // real paths so refresh/share keep working.
  const page = pageFromFlags({ tasksOpen, cronjobsOpen, appsOpen, skillsOpen, pluginsOpen, settingsOpen, teamChatOpen });
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
