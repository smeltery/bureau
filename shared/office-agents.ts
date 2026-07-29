import type { AgentInfo } from "./types.ts";
import { DEFAULT_AGENT_CAPABILITIES } from "./types.ts";
import { generateOutfit } from "./office-outfit.ts";

export function hasDuplicateAgentName(agents: Iterable<AgentInfo>, name: string, exceptAgentId?: string): boolean {
  const nameLower = name.trim().toLowerCase();
  for (const agent of agents) {
    if (agent.id !== exceptAgentId && agent.name.toLowerCase() === nameLower) return true;
  }
  return false;
}

export function roomIndexById(rooms: { id: string }[], roomId?: string): number {
  if (!roomId) return 0;
  const idx = rooms.findIndex((room) => room.id === roomId);
  return idx >= 0 ? idx : 0;
}

export function firstOpenDesk(agents: Iterable<AgentInfo>, room: number, preferredDesk?: number): number {
  if (preferredDesk !== undefined && (!Number.isInteger(preferredDesk) || preferredDesk < 0 || preferredDesk > 7)) return -1;
  const taken = new Set<number>();
  let count = 0;
  for (const agent of agents) {
    if (agent.room !== room) continue;
    taken.add(agent.desk);
    count++;
  }

  if (preferredDesk !== undefined && !taken.has(preferredDesk)) return preferredDesk;
  if (count >= 8) return -1;
  for (let desk = 0; desk < 8; desk++) {
    if (!taken.has(desk)) return desk;
  }
  return -1;
}

export function createAgentInfo(opts: { name: string; cwd: string; permissionMode: AgentInfo["permissionMode"]; desk: number; room: number; customInstructions?: string }): AgentInfo {
  return {
    id: `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: opts.name,
    desk: opts.desk,
    room: opts.room,
    cwd: opts.cwd,
    outfit: generateOutfit(),
    permissionMode: opts.permissionMode,
    modelFamily: "opus",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: opts.customInstructions || null,
  };
}
