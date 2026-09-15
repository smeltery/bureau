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
import type { AppListWire } from "../shared/apps.ts";
import type { RoomPet } from "../shared/types.ts";
import type { UpdateStatusWire } from "../shared/update-types.ts";
import { type SidePanel } from "./store-side-panels.ts";
import type { LogsReplay } from "./store-replay.ts";
import { useStoreEffects } from "./store-effects.ts";
import { initialState } from "./store-initial-state.ts";
import { reducer } from "./store-reducer.ts";
export { FeaturesProvider, ThemeProvider, useFeatures, useTheme } from "./themes/theme-context.tsx";

export interface AppState {
  agents: AgentInfo[];
  logs: Map<string, LogEntry[]>; // agentId → entries
  // Reconnect replay window, or null outside one. While this is set, incoming
  // log_entry frames land in the buffer instead of in `logs` so the focused
  // agent's transcript keeps rendering across the reconnect; the server's
  // `log_replay_complete` fence swaps it in atomically. See ui/store-replay.ts.
  logsReplay: LogsReplay | null;
  focusedAgentId: string | null;
  connected: boolean;
  // True once the first `full_state` message has been received. Distinct from
  // `connected`, which is deliberately tied to full_state arrival.
  hasReceivedInitialState: boolean;
  // Bumped on every `full_state`. full_state drops every log stream except the
  // focused agent's held transcript, and ws.ts can reconnect without ever
  // flipping `connected` (onVisible's pong timeout), so views that backfill a
  // log stream once must key their fetch on this epoch — a `connected` edge is
  // not something every reconnect produces.
  hydrationEpoch: number;
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
  // Agent-built apps. Fetched by AppsView when the tab opens (an app list costs
  // a systemd read on the server, so no session pays for a tab it never opens)
  // and kept fresh by the app_updated / app_removed deltas. full_state does
  // NOT carry apps and must never clear this slice — AppsView re-fetches on
  // hydrationEpoch instead.
  apps: AppListWire[];
  appsLoaded: boolean;
  // Bumped by every app delta. A list GET is a snapshot of the moment it was
  // ISSUED, so a slow one can land after a delta that supersedes it and
  // resurrect an app somebody just deleted. AppsView captures this when it
  // starts a fetch and hands it back on apps_loaded; a replacement whose
  // revision has moved is refused. Ordering GETs against each other is not
  // enough — the race is a GET against a DELTA.
  appsRevision: number;
  currentRoom: number; // 0-based room index (view selection only)
  /** When true, OfficeView draws the lobby scene instead of the current desk room. */
  lobbyOpen: boolean;
  cronjobs: Cronjob[];
  cronjobsLoaded: boolean;
  cronjobsPrompt: string | null;
  cronjobRunsByJob: Map<string, CronjobRun[]>;
  cronjobRunsLoaded: boolean;
  // Claude Code plugin catalog (installed + available + marketplaces). null
  // until the Plugins panel first fetches it; server broadcasts keep every
  // open browser in sync after mutations.
  ccPlugins: CCPluginsState | null;
  updateStatus: UpdateStatusWire;
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
  // Ends a reconnect replay window and swaps the buffered transcripts in. Sent
  // by the server after the last replayed frame; useStoreEffects also
  // synthesizes one on a timeout, for the window where a fresh UI build is
  // talking to a server old enough not to send it (UI builds go live before a
  // restart).
  | { type: "log_replay_complete" }
  | { type: "set_mobile"; isMobile: boolean }
  | { type: "toggle_mobile_view" }
  | { type: "office_settings_updated"; prompt: string | null; envFile: string | null; experimental?: { browserPanel: boolean } }
  | { type: "tasks"; tasks: TaskItem[] }
  // The Apps tab's list GET result (apps_loaded, local) and the server's app
  // deltas (app_updated / app_removed, straight off the wire).
  | { type: "apps_loaded"; apps: AppListWire[]; revision: number }
  | { type: "app_updated"; app: AppListWire }
  | { type: "app_removed"; name: string }
  | { type: "set_current_room"; room: number }
  | { type: "set_lobby_open"; open: boolean }
  | { type: "room_created"; room: RoomWire }
  | { type: "room_closed"; roomId: string }
  | { type: "room_renamed"; roomId: string; name: string }
  | { type: "room_settings_updated"; roomId: string; prompt: string | null; envFile: string | null }
  | { type: "room_pet_updated"; roomId: string; pet: RoomPet | null }
  | { type: "room_skin_updated"; roomId: string; skin: import("../shared/types.ts").RoomSkin | null }
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
  | ({ type: "update_status" } & UpdateStatusWire)
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
