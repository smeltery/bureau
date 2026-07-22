import { createContext, useContext, useReducer, type ReactNode, type Dispatch } from "react";
import type {
  AgentInfo,
  CCPluginsState,
  Cronjob,
  CronjobRun,
  InviteWire,
  KilledAgentSummary,
  LogEntry,
  SessionInfo,
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
import { type SidePanel } from "./store-side-panels.ts";
import { useStoreEffects } from "./store-effects.ts";
import { initialState } from "./store-initial-state.ts";
import { reducer } from "./store-reducer.ts";
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
  slashCommands: Map<string, { commands: { name: string; description?: string; aliasFor?: string; autoRun?: boolean }[]; skills: SkillInfo[] }>; // agentId → available commands
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
  sidePanels: Map<string, SidePanel>;
  // ACL-filtered list of currently-killed agents available to revive from the
  // spawn menu. Server-capped and ACL-filtered per session; the UI just
  // renders the array as chips sorted killedAt desc. The server pushes
  // additions/removals via killed_agent_added / killed_agent_removed events as
  // kills and revivals happen.
  killedAgents: KilledAgentSummary[];
}

export type Action =
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
  | { type: "slash_commands"; agentId: string; commands: { name: string; description?: string; aliasFor?: string; autoRun?: boolean }[]; skills: SkillInfo[] }
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
  | { type: "set_side_panel"; agentId: string; panel: SidePanel };

const StateCtx = createContext<AppState>(initialState);
const DispatchCtx = createContext<Dispatch<Action>>(() => {});

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, initialState);
  useStoreEffects(state, dispatch);

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
