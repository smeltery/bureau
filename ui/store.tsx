import { createContext, useContext, useReducer, useEffect, useRef, useState, useCallback, type ReactNode, type Dispatch } from "react";
import type {
  AgentInfo,
  Cronjob,
  CronjobRun,
  InviteWire,
  LogEntry,
  SessionInfo,
  ServerMessage,
  SkillInfo,
  TaskItem,
  OfficeSettings,
  RoomWire,
  SettingsSaveResponse,
  SettingsValidationResponse,
  SessionContext,
  SessionWire,
  PresenceInfo,
  UserRecord,
} from "../shared/types.ts";
import { connect } from "./ws.ts";
import { type Features, PRODUCTION_FEATURES } from "../shared/features.ts";
import { DEFAULT_THEME_ID, getThemeById, THEMES, type Theme, type ThemeMode } from "./themes.ts";

export interface AppState {
  agents: AgentInfo[];
  logs: Map<string, LogEntry[]>; // agentId → entries
  focusedAgentId: string | null;
  connected: boolean;
  // True once the first `full_state` message has been received. Distinct from
  // `connected`, which is deliberately tied to full_state arrival.
  hasReceivedInitialState: boolean;
  isMobile: boolean;
  mobileViewMode: "list" | "office"; // which view to show on mobile
  needsAttention: Set<string>; // agentIds with unread state changes
  sessionsList: Map<string, { sessions: SessionInfo[]; currentSessionId: string | null }>; // agentId → available sessions
  soundTrigger: number; // increments when any agent finishes work (for sound regardless of focus)
  drafts: Map<string, string>; // agentId → unsent chat input
  recentCwds: string[]; // persisted recent working directories
  slashCommands: Map<string, { commands: { name: string; description?: string; aliasFor?: string }[]; skills: SkillInfo[] }>; // agentId → available commands
  stateChangedAt: Map<string, number>; // agentId → timestamp when agent state last changed
  office: OfficeSettings;
  rooms: RoomWire[];
  allRooms: RoomWire[];
  users: Map<string, UserRecord>;
  sessionContext: SessionContext | null;
  activeSessions: SessionWire[];
  activeSessionsLoaded: boolean;
  invitesList: InviteWire[];
  invitesLoaded: boolean;
  presences: PresenceInfo[];
  totalOnlineUsers: number;
  tasks: TaskItem[];
  tasksLoaded: boolean;
  currentRoom: number; // 0-based room index (view selection only)
  cronjobs: Cronjob[];
  cronjobsLoaded: boolean;
  cronjobsPrompt: string | null;
  cronjobRunsByJob: Map<string, CronjobRun[]>;
  cronjobRunsLoaded: boolean;
  updateAvailable: boolean;
  updateCurrent: { sha: string; message: string; date: string };
  updateLatest: { sha: string; message: string; date: string };
  // Per-agent side panel state: which side panel (if any) is open next to
  // the chat. Persisted to localStorage per-agent so switching between
  // agents and reloading both restore the right panel.
  sidePanels: Map<string, "terminal" | "editor" | null>;
}

const SIDE_PANEL_KEY = "bureau:side-panels";

function readSidePanels(): Map<string, "terminal" | "editor" | null> {
  if (typeof localStorage === "undefined") return new Map();
  try {
    const raw = localStorage.getItem(SIDE_PANEL_KEY);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, "terminal" | "editor" | null>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function writeSidePanels(map: Map<string, "terminal" | "editor" | null>) {
  if (typeof localStorage === "undefined") return;
  try {
    const obj: Record<string, "terminal" | "editor" | null> = {};
    map.forEach((v, k) => {
      if (v) obj[k] = v;
    });
    localStorage.setItem(SIDE_PANEL_KEY, JSON.stringify(obj));
  } catch {}
}

type Action =
  | { type: "full_state"; agents: AgentInfo[]; recentCwds: string[]; office: OfficeSettings; rooms: RoomWire[]; allRooms?: RoomWire[] }
  | { type: "session_context"; context: SessionContext | null }
  | { type: "presence_list"; entries: PresenceInfo[]; totalOnlineUsers: number }
  | { type: "users_list"; users: UserRecord[] }
  | { type: "sessions_active_list"; sessions: SessionWire[] }
  | { type: "invites_list"; invites: InviteWire[] }
  | { type: "invite_revoked"; tokenPrefix: string }
  | { type: "session_revoked"; sessionPrefix: string }
  | { type: "agent_added"; agent: AgentInfo }
  | { type: "agent_removed"; agentId: string }
  | { type: "agent_updated"; agentId: string; changes: Partial<AgentInfo> }
  | { type: "log_entry"; entry: LogEntry }
  | { type: "focus"; agentId: string | null }
  | { type: "connected" }
  | { type: "disconnected" }
  | { type: "sessions_list"; agentId: string; sessions: SessionInfo[]; currentSessionId: string | null }
  | { type: "set_draft"; agentId: string; text: string }
  | { type: "slash_commands"; agentId: string; commands: { name: string; description?: string; aliasFor?: string }[]; skills: SkillInfo[] }
  | { type: "clear_logs"; agentId: string }
  | { type: "set_mobile"; isMobile: boolean }
  | { type: "toggle_mobile_view" }
  | { type: "office_settings_updated"; prompt: string | null; envFile: string | null }
  | { type: "tasks"; tasks: TaskItem[] }
  | { type: "set_current_room"; room: number }
  | { type: "room_created"; room: RoomWire }
  | { type: "room_closed"; roomId: string }
  | { type: "room_renamed"; roomId: string; name: string }
  | { type: "room_settings_updated"; roomId: string; prompt: string | null; envFile: string | null }
  | { type: "rooms_reordered"; order: string[] }
  | { type: "cronjobs_state"; cronjobs: Cronjob[]; cronjobsPrompt: string | null }
  | { type: "cronjob_added"; cronjob: Cronjob }
  | { type: "cronjob_updated"; cronjob: Cronjob }
  | { type: "cronjob_deleted"; id: string }
  | { type: "cronjobs_prompt_updated"; value: string | null }
  | { type: "cronjob_runs"; cronjobId: string; runs: CronjobRun[] }
  | { type: "cronjob_runs_complete" }
  | { type: "cronjob_run_updated"; run: CronjobRun }
  | SettingsSaveResponse
  | SettingsValidationResponse
  | { type: "update_status"; updateAvailable: boolean; current: { sha: string; message: string; date: string }; latest: { sha: string; message: string; date: string } }
  | { type: "set_side_panel"; agentId: string; panel: "terminal" | "editor" | null };

// States that warrant attention
const ATTENTION_STATES = new Set(["idle", "error", "waiting_for_response"]);

function reducer(state: AppState, action: Action): AppState {
  switch (action.type) {
    case "full_state":
      return {
        ...state,
        agents: action.agents,
        recentCwds: action.recentCwds,
        office: action.office,
        rooms: action.rooms,
        allRooms: action.allRooms ?? action.rooms,
        currentRoom: Math.min(state.currentRoom, Math.max(0, action.rooms.length - 1)),
        logs: new Map(),
        needsAttention: new Set(),
        slashCommands: new Map(),
        stateChangedAt: new Map(action.agents.filter((a) => a.state !== "idle" && a.state !== "stopped").map((a) => [a.id, Date.now()])),
        hasReceivedInitialState: true,
      };
    case "session_context":
      // Reset both invite + session loaded flags on session_context so the
      // Access pane re-fetches across WS reconnects. The new context could
      // be a different user; previously-cached owner lists must not leak.
      return { ...state, sessionContext: action.context, activeSessionsLoaded: false, invitesLoaded: false };
    case "users_list":
      return { ...state, users: new Map(action.users.map((u) => [u.name.trim().toLocaleLowerCase(), u])) };
    case "sessions_active_list":
      return { ...state, activeSessions: action.sessions, activeSessionsLoaded: true };
    case "invites_list":
      return { ...state, invitesList: action.invites, invitesLoaded: true };
    case "invite_revoked":
      return { ...state, invitesList: state.invitesList.filter((i) => i.tokenPrefix !== action.tokenPrefix) };
    case "session_revoked":
      return { ...state, activeSessions: state.activeSessions.filter((s) => s.sessionPrefix !== action.sessionPrefix) };
    case "presence_list":
      return { ...state, presences: action.entries, totalOnlineUsers: action.totalOnlineUsers };
    case "agent_added":
      return { ...state, agents: [...state.agents, action.agent] };
    case "agent_removed": {
      const logs = new Map(state.logs);
      logs.delete(action.agentId);
      const needsAttention = new Set(state.needsAttention);
      needsAttention.delete(action.agentId);
      const sidePanels = new Map(state.sidePanels);
      if (sidePanels.delete(action.agentId)) writeSidePanels(sidePanels);
      return {
        ...state,
        agents: state.agents.filter((a) => a.id !== action.agentId),
        logs,
        needsAttention,
        sidePanels,
        focusedAgentId: state.focusedAgentId === action.agentId ? null : state.focusedAgentId,
      };
    }
    case "agent_updated": {
      const newAgents = state.agents.map((a) => (a.id === action.agentId ? { ...a, ...action.changes } : a));
      const needsAttention = new Set(state.needsAttention);
      // Track when state changes for elapsed time display
      const stateChangedAt = action.changes.state ? new Map(state.stateChangedAt).set(action.agentId, Date.now()) : state.stateChangedAt;
      // Mark as needing attention if state changed to an attention state
      // and the user is not currently viewing this agent
      if (action.changes.state && ATTENTION_STATES.has(action.changes.state)) {
        const prevAgent = state.agents.find((a) => a.id === action.agentId);
        const wasWorking = prevAgent && !ATTENTION_STATES.has(prevAgent.state);
        let soundTrigger = state.soundTrigger;
        if (wasWorking) {
          // Sound: only fire when the turn that's ending originated from a
          // human message. Pure agent-to-agent traffic (one agent pings
          // another, the receiver answers and idles) stays silent — see
          // turnHadHumanInput on the server side.
          if (prevAgent.turnHadHumanInput) {
            soundTrigger = state.soundTrigger + 1;
          }
          // Badge: only when not viewing this agent. Set regardless of input
          // source — the dot is a "this agent stopped, you might want to
          // look" cue, distinct from the audible nudge.
          if (state.focusedAgentId !== action.agentId) {
            needsAttention.add(action.agentId);
          }
        }
        return { ...state, agents: newAgents, needsAttention, soundTrigger, stateChangedAt };
      }
      return { ...state, agents: newAgents, needsAttention, stateChangedAt };
    }
    case "log_entry": {
      const logs = new Map(state.logs);
      const entries = logs.get(action.entry.agentId) ?? [];
      // Dedupe by entry id: backfill of a cronjob run can replay entries that
      // already arrived live, and the same id should never appear twice.
      // Use a Set for O(1) membership rather than entries.some(...).
      const seen = new Set(entries.map((e) => e.id));
      if (seen.has(action.entry.id)) return state;
      logs.set(action.entry.agentId, [...entries, action.entry]);
      return { ...state, logs };
    }
    case "focus": {
      const needsAttention = new Set(state.needsAttention);
      if (action.agentId) {
        needsAttention.delete(action.agentId);
      }
      return { ...state, focusedAgentId: action.agentId, needsAttention };
    }
    case "connected":
      return { ...state, connected: true };
    case "disconnected":
      return { ...state, connected: false };
    case "sessions_list": {
      const sessionsList = new Map(state.sessionsList);
      sessionsList.set(action.agentId, { sessions: action.sessions, currentSessionId: action.currentSessionId });
      return { ...state, sessionsList };
    }
    case "set_draft": {
      const drafts = new Map(state.drafts);
      if (action.text) {
        drafts.set(action.agentId, action.text);
      } else {
        drafts.delete(action.agentId);
      }
      return { ...state, drafts };
    }
    case "slash_commands": {
      const slashCommands = new Map(state.slashCommands);
      slashCommands.set(action.agentId, { commands: action.commands, skills: action.skills });
      return { ...state, slashCommands };
    }
    case "clear_logs": {
      const logs = new Map(state.logs);
      logs.set(action.agentId, []);
      return { ...state, logs };
    }
    case "set_mobile":
      return { ...state, isMobile: action.isMobile };
    case "toggle_mobile_view": {
      const next = state.mobileViewMode === "list" ? "office" : "list";
      if (typeof localStorage !== "undefined") localStorage.setItem("bureau-mobile-view", next);
      return { ...state, mobileViewMode: next };
    }
    case "office_settings_updated":
      return { ...state, office: { prompt: action.prompt, envFile: action.envFile } };
    case "tasks":
      return { ...state, tasks: action.tasks, tasksLoaded: true };
    case "set_current_room":
      return { ...state, currentRoom: action.room };
    case "room_created":
      return { ...state, rooms: [...state.rooms, action.room] };
    case "update_status":
      return { ...state, updateAvailable: action.updateAvailable, updateCurrent: action.current, updateLatest: action.latest };
    case "room_closed": {
      const idx = state.rooms.findIndex((r) => r.id === action.roomId);
      if (idx < 0) return state;
      const newRooms = [...state.rooms];
      newRooms.splice(idx, 1);
      let currentRoom = state.currentRoom;
      if (currentRoom === idx) currentRoom = 0;
      else if (currentRoom > idx) currentRoom--;
      return { ...state, rooms: newRooms, currentRoom };
    }
    case "room_renamed": {
      const newRooms = state.rooms.map((r) => (r.id === action.roomId ? { ...r, name: action.name } : r));
      return { ...state, rooms: newRooms };
    }
    case "room_settings_updated": {
      const newRooms = state.rooms.map((r) => (r.id === action.roomId ? { ...r, prompt: action.prompt, envFile: action.envFile } : r));
      return { ...state, rooms: newRooms };
    }
    case "cronjobs_state":
      return { ...state, cronjobs: action.cronjobs, cronjobsPrompt: action.cronjobsPrompt, cronjobsLoaded: true };
    case "cronjob_added":
      return { ...state, cronjobs: [...state.cronjobs.filter((c) => c.id !== action.cronjob.id), action.cronjob] };
    case "cronjob_updated":
      return { ...state, cronjobs: state.cronjobs.map((c) => (c.id === action.cronjob.id ? action.cronjob : c)) };
    case "cronjob_deleted":
      return { ...state, cronjobs: state.cronjobs.filter((c) => c.id !== action.id) };
    case "cronjobs_prompt_updated":
      return { ...state, cronjobsPrompt: action.value };
    case "cronjob_runs": {
      const next = new Map(state.cronjobRunsByJob);
      next.set(action.cronjobId, action.runs);
      return { ...state, cronjobRunsByJob: next };
    }
    case "cronjob_runs_complete":
      return { ...state, cronjobRunsLoaded: true };
    case "cronjob_run_updated": {
      const next = new Map(state.cronjobRunsByJob);
      const list = next.get(action.run.cronjobId) ?? [];
      const idx = list.findIndex((r) => r.id === action.run.id);
      if (idx < 0) next.set(action.run.cronjobId, [...list, action.run]);
      else {
        const updated = list.slice();
        updated[idx] = action.run;
        next.set(action.run.cronjobId, updated);
      }
      return { ...state, cronjobRunsByJob: next };
    }
    case "set_side_panel": {
      const sidePanels = new Map(state.sidePanels);
      if (action.panel) sidePanels.set(action.agentId, action.panel);
      else sidePanels.delete(action.agentId);
      writeSidePanels(sidePanels);
      return { ...state, sidePanels };
    }
    case "rooms_reordered": {
      // action.order is the new ordering of roomIds
      const idToOldIdx = new Map(state.rooms.map((r, i) => [r.id, i]));
      const newRooms = action.order.map((id) => state.rooms[idToOldIdx.get(id)!]).filter(Boolean);
      // Recompute currentRoom: find where the previously-current room landed
      const prevId = state.rooms[state.currentRoom]?.id;
      const newCurrentRoom = prevId ? Math.max(0, action.order.indexOf(prevId)) : 0;
      // Remap agents' numeric room index to the new positions
      const idToNewIdx = new Map(newRooms.map((r, i) => [r.id, i]));
      const newAgents = state.agents.map((a) => {
        const oldId = state.rooms[a.room]?.id;
        if (!oldId) return a;
        const newIdx = idToNewIdx.get(oldId) ?? a.room;
        return newIdx !== a.room ? { ...a, room: newIdx } : a;
      });
      return { ...state, rooms: newRooms, agents: newAgents, currentRoom: newCurrentRoom };
    }
    default:
      return state;
  }
}

const initialState: AppState = {
  agents: [],
  logs: new Map(),
  focusedAgentId: null,
  connected: false,
  hasReceivedInitialState: false,
  isMobile: typeof window !== "undefined" ? window.innerWidth < 768 : false,
  mobileViewMode: typeof localStorage !== "undefined" && localStorage.getItem("bureau-mobile-view") === "list" ? "list" : "office",
  needsAttention: new Set(),
  sessionsList: new Map(),
  soundTrigger: 0,
  drafts: new Map(),
  recentCwds: [],
  slashCommands: new Map(),
  stateChangedAt: new Map(),
  office: { prompt: null, envFile: null },
  rooms: [],
  allRooms: [],
  users: new Map(),
  sessionContext: null,
  activeSessions: [],
  activeSessionsLoaded: false,
  invitesList: [],
  invitesLoaded: false,
  presences: [],
  totalOnlineUsers: 0,
  tasks: [],
  tasksLoaded: false,
  currentRoom: 0,
  cronjobs: [],
  cronjobsLoaded: false,
  cronjobsPrompt: null,
  cronjobRunsByJob: new Map(),
  cronjobRunsLoaded: false,
  updateAvailable: false,
  updateCurrent: { sha: "", message: "", date: "" },
  updateLatest: { sha: "", message: "", date: "" },
  sidePanels: readSidePanels(),
};

const StateCtx = createContext<AppState>(initialState);
const DispatchCtx = createContext<Dispatch<Action>>(() => {});

// Notification sound — AudioContext initialized on first user interaction
let audioCtx: AudioContext | null = null;

function ensureAudioContext() {
  if (!audioCtx) {
    audioCtx = new AudioContext();
  }
  return audioCtx;
}

// Initialize audio on first click anywhere
if (typeof document !== "undefined") {
  document.addEventListener("click", () => ensureAudioContext(), { once: true });
}

function playNotificationSound() {
  try {
    const ctx = ensureAudioContext();
    if (ctx.state === "suspended") ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.setValueAtTime(800, ctx.currentTime);
    osc.frequency.setValueAtTime(600, ctx.currentTime + 0.1);
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.3);
  } catch {}
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);

  useEffect(() => {
    connect(
      (msg: ServerMessage) => {
        dispatch(msg as Action);
        if (msg.type === "full_state") dispatch({ type: "connected" });
        // Server-initiated session invalidation (revoke / logout / expiry /
        // delete-user fanout). The server sends `session_expired` immediately
        // before force-closing the WS, so reload here lets the login wall take
        // over instead of looping reconnect against a 401-returning upgrade.
        if (msg.type === "session_expired") {
          if (typeof window !== "undefined") window.location.reload();
        }
      },
      (isConnected: boolean) => {
        if (!isConnected) dispatch({ type: "disconnected" });
      },
    );
  }, []);

  // Track mobile viewport
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    function handleResize() {
      clearTimeout(timer);
      timer = setTimeout(() => {
        dispatch({ type: "set_mobile", isMobile: window.innerWidth < 768 });
      }, 150);
    }
    window.addEventListener("resize", handleResize);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  // Sound notification when tab is hidden and any agent finishes work
  const prevSoundTrigger = useRef(0);
  useEffect(() => {
    if (state.soundTrigger > prevSoundTrigger.current && document.hidden) {
      playNotificationSound();
    }
    prevSoundTrigger.current = state.soundTrigger;
  }, [state.soundTrigger]);

  return (
    <StateCtx.Provider value={state}>
      <DispatchCtx.Provider value={dispatch}>{children}</DispatchCtx.Provider>
    </StateCtx.Provider>
  );
}

export function useAppState() {
  return useContext(StateCtx);
}

export function useDispatch() {
  return useContext(DispatchCtx);
}

// Theme management — persisted to localStorage, applied via data-theme +
// data-theme-mode attributes on <html>. `theme` is the registered id;
// `mode` is the resolved 'dark'|'light' from the THEMES table and drives
// the handful of mode-dependent CSS rules (lamp glow, neon, diff2html).
interface ThemeContextValue {
  theme: string;
  mode: ThemeMode;
  setTheme: (id: string) => void;
  toggleTheme: () => void;
}

const ThemeCtx = createContext<ThemeContextValue>({
  theme: DEFAULT_THEME_ID,
  mode: "dark",
  setTheme: () => {},
  toggleTheme: () => {},
});

// Resolve the OS / browser color-scheme preference. Used as the default when
// the user hasn't picked a theme yet (and when they switch back to following
// system later, via the media-query listener below).
function getSystemThemeId(): string {
  if (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-color-scheme: light)").matches) {
    return "light";
  }
  return DEFAULT_THEME_ID;
}

const USER_PICK_KEY = "bureau-theme";

function hasUserPickedTheme(): boolean {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(USER_PICK_KEY) != null;
}

function getInitialThemeId(): string {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(USER_PICK_KEY);
    if (saved) {
      // If the stored id isn't a known theme, getThemeById falls back to
      // the default — return the canonical id so we don't keep round-
      // tripping the stale value.
      return getThemeById(saved).id;
    }
  }
  // No explicit user choice: follow the OS preference.
  return getSystemThemeId();
}

const LAST_THEME_KEY = {
  dark: "bureau-theme-dark",
  light: "bureau-theme-light",
} as const;

// Remembers the most recent theme picked within each mode so the moon/sun
// toggle can return the user to their preferred Nord (dark) or Solarized
// Light (light) instead of always reverting to the canonical pair.
function getLastModeTheme(mode: ThemeMode): string {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(LAST_THEME_KEY[mode]);
    if (saved) {
      const resolved = getThemeById(saved);
      if (resolved.mode === mode) return resolved.id;
    }
  }
  return THEMES.find((t) => t.mode === mode)?.id ?? DEFAULT_THEME_ID;
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<string>(getInitialThemeId);
  // Track whether the current theme came from an explicit user pick or from
  // the OS preference. While following the OS, we don't persist anything and
  // we live-react to `prefers-color-scheme` changes. Once the user picks a
  // theme (via ThemePicker or the moon/sun toggle), it sticks.
  const [userPicked, setUserPicked] = useState<boolean>(hasUserPickedTheme);
  const resolved: Theme = getThemeById(themeId);

  useEffect(() => {
    document.documentElement.setAttribute("data-theme", resolved.id);
    document.documentElement.setAttribute("data-theme-mode", resolved.mode);
    if (userPicked) {
      localStorage.setItem(USER_PICK_KEY, resolved.id);
      localStorage.setItem(LAST_THEME_KEY[resolved.mode], resolved.id);
    }
    const color = resolved.vars["--bg-base"];
    let meta = document.querySelector<HTMLMetaElement>('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement("meta");
      meta.name = "theme-color";
      document.head.appendChild(meta);
    }
    meta.content = color;
  }, [resolved, userPicked]);

  // While we're following the OS preference (no explicit pick), swap the
  // theme live if the system flips between dark and light. Stops listening
  // once the user picks something explicit, since their choice should win.
  useEffect(() => {
    if (userPicked) return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => setThemeId(getSystemThemeId());
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [userPicked]);

  // Cross-window sync. Fires when another window on the same origin writes
  // to our localStorage key — covers the landing's theme toggle updating
  // an embedded demo iframe (where the marketing site renders bureau), and
  // the reverse (clicking the wall moon inside the demo updates the
  // landing's palette).
  useEffect(() => {
    if (typeof window === "undefined") return;
    function onStorage(e: StorageEvent) {
      if (e.key !== USER_PICK_KEY && e.key !== null) return;
      if (e.newValue) {
        setUserPicked(true);
        setThemeId(getThemeById(e.newValue).id);
      } else {
        // Key was cleared in another window — go back to following the OS.
        setUserPicked(false);
        setThemeId(getSystemThemeId());
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((id: string) => {
    setUserPicked(true);
    setThemeId(getThemeById(id).id);
  }, []);

  // The moon/sun nav button (and the wall sun/moon Easter egg) flip between
  // modes. We jump to the user's most recently picked theme in the opposite
  // mode rather than the canonical Dark/Light pair, so someone using Nord +
  // Solarized Light gets ferried between their two preferred themes.
  const toggleTheme = useCallback(() => {
    setUserPicked(true);
    setThemeId((current) => {
      const currentMode = getThemeById(current).mode;
      const oppositeMode: ThemeMode = currentMode === "dark" ? "light" : "dark";
      return getLastModeTheme(oppositeMode);
    });
  }, []);

  return <ThemeCtx.Provider value={{ theme: resolved.id, mode: resolved.mode, setTheme, toggleTheme }}>{children}</ThemeCtx.Provider>;
}

export function useTheme() {
  return useContext(ThemeCtx);
}

// Feature flags context — production defaults, demo overrides
const FeaturesCtx = createContext<Features>(PRODUCTION_FEATURES);

export function FeaturesProvider({ features, children }: { features: Features; children: ReactNode }) {
  return <FeaturesCtx.Provider value={features}>{children}</FeaturesCtx.Provider>;
}

export function useFeatures() {
  return useContext(FeaturesCtx);
}
