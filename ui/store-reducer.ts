import { KILLED_AGENT_CHIP_CAP } from "../shared/types.ts";
import { applyRoomClose, resolveSelectedRoomId, roomIndexById } from "./roomSelection.ts";
import { writeSidePanels } from "./store-side-panels.ts";
import type { Action, AppState } from "./store.tsx";

// States that warrant attention
const ATTENTION_STATES = new Set(["idle", "error", "waiting_for_response"]);

export function reducer(state: AppState, action: Action): AppState {
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
