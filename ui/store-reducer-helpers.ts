import { resolveSelectedRoomId, roomIndexById } from "./roomSelection.ts";
import type { Action, AppState } from "./store.tsx";

type AgentUpdatedAction = Extract<Action, { type: "agent_updated" }>;
type RoomsReorderedAction = Extract<Action, { type: "rooms_reordered" }>;

// States that warrant attention
const ATTENTION_STATES = new Set(["idle", "error", "waiting_for_response"]);

export function applyAgentUpdated(state: AppState, action: AgentUpdatedAction): AppState {
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

export function applyRoomsReordered(state: AppState, action: RoomsReorderedAction): AppState {
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
