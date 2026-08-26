import type { AgentBackendType, AgentInfo, AgentOutfit } from "../../shared/types.ts";
import { DEFAULT_AGENT_CAPABILITIES } from "../../shared/types.ts";
import { DESK_COUNT, isValidDesk } from "../../shared/desks.ts";
import { versionOf } from "../memory-store.ts";
import { getBackend } from "../backends/index.ts";
import { generateOutfit } from "./outfit.ts";
import { resolveCwd } from "./session/paths.ts";
import type { InternalRoom, ManagedAgent } from "./state.ts";

export interface SpawnAgentDraft {
  info: AgentInfo;
  resolvedCwd: string;
}

export function buildSpawnAgentDraft({
  name,
  cwd,
  permissionMode,
  desk,
  customInstructions,
  roomId,
  outfit,
  modelFamily,
  agentType,
  codexSandbox,
  effort,
  userId,
  agents,
  rooms,
}: {
  name: string;
  cwd: string;
  permissionMode: AgentInfo["permissionMode"];
  desk?: number;
  customInstructions?: string;
  roomId?: string;
  outfit?: AgentOutfit;
  modelFamily?: string;
  agentType: AgentBackendType;
  codexSandbox?: AgentInfo["codexSandbox"];
  effort?: AgentInfo["effort"];
  userId?: string | null;
  agents: Iterable<ManagedAgent>;
  rooms: InternalRoom[];
}): SpawnAgentDraft | null {
  const existingAgents = [...agents];
  const nameLower = name.trim().toLowerCase();
  if (existingAgents.some((a) => a.info.name.toLowerCase() === nameLower)) {
    return null;
  }

  const targetRoom = resolveSpawnRoom(rooms, roomId);
  const targetDesk = resolveSpawnDesk(existingAgents, targetRoom, desk);
  if (targetDesk === null) return null;

  const resolvedCwd = resolveCwd(cwd);
  const id = `agent-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const info: AgentInfo = {
    id,
    name,
    userId: userId ?? null,
    desk: targetDesk,
    room: targetRoom,
    cwd: resolvedCwd,
    outfit: outfit ?? generateOutfit(),
    permissionMode,
    modelFamily: modelFamily ?? "opus",
    agentType,
    capabilities: getBackend(agentType).capabilities ?? DEFAULT_AGENT_CAPABILITIES,
    privileged: false,
    ...(codexSandbox ? { codexSandbox } : {}),
    ...(effort ? { effort } : {}),
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: customInstructions || null,
    customInstructionsVersion: versionOf(customInstructions ?? ""),
    queue: [],
  };

  return { info, resolvedCwd };
}

function resolveSpawnRoom(rooms: InternalRoom[], roomId?: string): number {
  if (!roomId) return 0;
  const idx = rooms.findIndex((room) => room.id === roomId);
  return idx >= 0 ? idx : 0;
}

function resolveSpawnDesk(agents: ManagedAgent[], targetRoom: number, requestedDesk?: number): number | null {
  const roomAgents = agents.filter((a) => a.info.room === targetRoom);
  const taken = new Set(roomAgents.map((a) => a.info.desk));
  if (requestedDesk !== undefined && !isValidDesk(requestedDesk)) {
    return null;
  }
  if (requestedDesk !== undefined && !taken.has(requestedDesk)) {
    return requestedDesk;
  }
  for (let desk = 0; desk < DESK_COUNT; desk++) {
    if (!taken.has(desk)) return desk;
  }
  return null;
}
