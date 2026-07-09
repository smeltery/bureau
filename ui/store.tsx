import { createContext, useContext, useReducer, useEffect, useRef, type ReactNode, type Dispatch } from "react";
import type {
  AgentInfo,
  CCPluginsState,
  Cronjob,
  CronjobRun,
  InviteWire,
  KilledAgentSummary,
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
import { KILLED_AGENT_CHIP_CAP } from "../shared/types.ts";
import { connect } from "./ws.ts";
import { shouldNotifyRoom } from "../shared/notifications.ts";
import { showDesktopNotification, markAttention } from "./notifications.ts";
import { applyRoomClose, resolveSelectedRoomId, roomIndexById } from "./roomSelection.ts";
export { FeaturesProvider, ThemeProvider, useFeatures, useTheme } from "./theme-context.tsx";

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
  // Bumped when any agent finishes work. Carries the finishing agent's room
  // (for per-room notification gating) and identity (for the desktop toast).
  soundTrigger: { seq: number; roomId: string | null; agentId: string | null; agentName: string | null };
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
  // Claude Code plugin catalog (installed + available + marketplaces). null
  // until the Plugins panel first fetches it; server broadcasts keep every
  // open browser in sync after mutations.
  ccPlugins: CCPluginsState | null;
  updateAvailable: boolean;
  updateCurrent: { sha: string; message: string; date: string };
  updateLatest: { sha: string; message: string; date: string };
  // Per-agent side panel state: which side panel (if any) is open next to
  // the chat. Persisted to localStorage per-agent so switching between
  // agents and reloading both restore the right panel.
  sidePanels: Map<string, "terminal" | "editor" | null>;
  // ACL-filtered list of currently-killed agents available to revive from the
  // spawn menu. Server-capped and ACL-filtered per session; the UI just
  // renders the array as chips sorted killedAt desc. The server pushes
  // additions/removals via killed_agent_added / killed_agent_removed events as
  // kills and revivals happen.
  killedAgents: KilledAgentSummary[];
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
  | { type: "full_state"; agents: AgentInfo[]; recentCwds: string[]; office: OfficeSettings; rooms: RoomWire[]; allRooms?: RoomWire[]; killedAgents: KilledAgentSummary[] }
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
  | { type: "killed_agent_added"; agent: KilledAgentSummary }
  | { type: "killed_agent_removed"; agentId: string; lastRoomId: string }
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
  | { type: "cc_plugins_state"; plugins: CCPluginsState }
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
    case "full_state": {
      const currentRoomId = state.rooms[state.currentRoom]?.id ?? null;
      const nextRoomId = resolveSelectedRoomId(action.rooms, currentRoomId);
      return {
        ...state,
        agents: action.agents,
        recentCwds: action.recentCwds,
        office: action.office,
        rooms: action.rooms,
        allRooms: action.allRooms ?? action.rooms,
        currentRoom: roomIndexById(action.rooms, nextRoomId),
        logs: new Map(),
        needsAttention: new Set(),
        slashCommands: new Map(),
        stateChangedAt: new Map(action.agents.filter((a) => a.state !== "idle" && a.state !== "stopped").map((a) => [a.id, Date.now()])),
        killedAgents: action.killedAgents,
        hasReceivedInitialState: true,
      };
    }
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
    case "killed_agent_added": {
      // De-dupe in case the server re-emits (defensive) and prepend so the
      // newest kill is left-most in the chip row. The server-side cap is a
      // soft limit; slice here too in case multi-emit pushes past it.
      const existing = state.killedAgents.filter((k) => k.id !== action.agent.id);
      return { ...state, killedAgents: [action.agent, ...existing].slice(0, KILLED_AGENT_CHIP_CAP) };
    }
    case "killed_agent_removed":
      return { ...state, killedAgents: state.killedAgents.filter((k) => k.id !== action.agentId) };
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
            const roomId = state.rooms[prevAgent.room]?.id ?? null;
            soundTrigger = { seq: state.soundTrigger.seq + 1, roomId, agentId: prevAgent.id, agentName: prevAgent.name };
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
      const currentRoomId = state.rooms[state.currentRoom]?.id ?? null;
      const result = applyRoomClose(state.rooms, action.roomId, currentRoomId);
      if (!result) return state;
      return { ...state, rooms: result.rooms, currentRoom: roomIndexById(result.rooms, result.currentRoomId) };
    }
    case "room_renamed": {
      const newRooms = state.rooms.map((r) => (r.id === action.roomId ? { ...r, name: action.name } : r));
      return { ...state, rooms: newRooms };
    }
    case "room_settings_updated": {
      const newRooms = state.rooms.map((r) => (r.id === action.roomId ? { ...r, prompt: action.prompt, envFile: action.envFile } : r));
      return { ...state, rooms: newRooms };
    }
    case "cc_plugins_state":
      return { ...state, ccPlugins: action.plugins };
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
      const newCurrentRoom = roomIndexById(newRooms, resolveSelectedRoomId(newRooms, prevId ?? null));
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
  soundTrigger: { seq: 0, roomId: null, agentId: null, agentName: null },
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
  ccPlugins: null,
  updateAvailable: false,
  updateCurrent: { sha: "", message: "", date: "" },
  updateLatest: { sha: "", message: "", date: "" },
  sidePanels: readSidePanels(),
  killedAgents: [],
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

  // When the tab is hidden and an agent finishes work, alert the user — gated
  // by their per-room notification preference (server-stored notifRooms). The
  // sound is the in-tab cue; the desktop toast + title/favicon badge reach the
  // user when the tab isn't even visible.
  const prevSoundTriggerSeq = useRef(0);
  useEffect(() => {
    const trigger = state.soundTrigger;
    if (trigger.seq > prevSoundTriggerSeq.current && document.hidden) {
      const me = state.sessionContext ? state.users.get(state.sessionContext.username.trim().toLocaleLowerCase()) : undefined;
      const notifRooms = me?.notifRooms ?? [];
      if (shouldNotifyRoom(trigger.roomId, notifRooms)) {
        playNotificationSound();
        markAttention();
        if (trigger.agentId) {
          const agentId = trigger.agentId;
          showDesktopNotification({
            title: `${trigger.agentName ?? "An agent"} is done`,
            body: "Ready for your reply in Bureau.",
            tag: agentId,
            onClick: () => dispatch({ type: "focus", agentId }),
          });
        }
      }
    }
    prevSoundTriggerSeq.current = trigger.seq;
  }, [state.soundTrigger, state.sessionContext, state.users]);

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
