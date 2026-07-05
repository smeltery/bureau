import { join } from "path";
import { readFileSync, existsSync } from "fs";
import type { AgentInfo, ClaudeModel } from "../../../shared/types.ts";
import { familyFromLegacyModel, generateRoomId } from "../../../shared/types.ts";
import { AGENTS_FILE, atomicWriteFileSync, LOGS_DIR, MANIFEST_FILE } from "../paths.ts";

// Persisted agent config (subset of AgentInfo + session tracking)
export interface PersistedAgent {
  id: string;
  name: string;
  userId?: string | null;
  desk: number;
  cwd: string;
  outfit: AgentInfo["outfit"];
  permissionMode: AgentInfo["permissionMode"];
  modelFamily?: string;
  agentType?: AgentInfo["agentType"];
  codexSandbox?: AgentInfo["codexSandbox"];
  effort?: AgentInfo["effort"];
  lastSessionId: string | null;
  topic: string | null;
  customInstructions: string | null;
}

// Migrate a persisted agent that may have the legacy `model: "claude-opus-4-6"`
// field to the current `modelFamily: "opus"` shape. Mutates in place.
function migratePersistedAgent(agent: any) {
  if (agent.modelFamily) return;
  if (typeof agent.model === "string") {
    agent.modelFamily = familyFromLegacyModel(agent.model);
    delete agent.model;
  }
}

export interface Room {
  id: string; // stable 8-char hex
  name: string; // display name
  prompt: string | null; // room-level prompt
  envFile: string | null; // absolute path to dotenv file
  agents: PersistedAgent[];
}

export function loadAgents(): Room[] {
  const defaultRoom = (): Room => ({ id: generateRoomId(), name: "Room 1", prompt: null, envFile: null, agents: [] });
  let rooms: any[];
  try {
    if (!existsSync(AGENTS_FILE)) return [defaultRoom()];
    const content = readFileSync(AGENTS_FILE, "utf-8");
    const parsed = JSON.parse(content);
    if (!Array.isArray(parsed) || parsed.length === 0) return [defaultRoom()];

    const first = parsed[0];

    if (first && typeof first === "object" && "name" in first && "agents" in first) {
      rooms = parsed;
    } else if (Array.isArray(first)) {
      rooms = (parsed as PersistedAgent[][]).map((agents, i) => ({
        id: generateRoomId(),
        name: `Room ${i + 1}`,
        prompt: null,
        envFile: null,
        agents,
      }));
    } else {
      rooms = [{ id: generateRoomId(), name: "Room 1", prompt: null, envFile: null, agents: parsed as PersistedAgent[] }];
    }
  } catch {
    return [defaultRoom()];
  }

  // Migrate each room: fill in missing id / prompt / envFile.
  // Collect already-present ids to avoid collisions during migration.
  const existingIds: string[] = rooms.map((r) => r.id).filter((id): id is string => typeof id === "string" && id.length > 0);
  for (const room of rooms) {
    if (typeof room.id !== "string" || room.id.length === 0) {
      room.id = generateRoomId(existingIds);
      existingIds.push(room.id);
    }
    if (typeof room.prompt !== "string") room.prompt = null;
    if (typeof room.envFile !== "string") room.envFile = null;
    for (const agent of room.agents as PersistedAgent[]) migratePersistedAgent(agent);
  }
  return rooms as Room[];
}

export function saveAgents(rooms: Room[]) {
  try {
    atomicWriteFileSync(AGENTS_FILE, JSON.stringify(rooms, null, 2));
  } catch (err) {
    console.error("Failed to save agents:", err);
  }
}

export function writeManifest(agents: { id: string; name: string; desk: number; room: number; roomName: string; topic: string | null; cwd: string; modelFamily: string; model: ClaudeModel }[]) {
  try {
    const manifest = agents.map((a) => ({
      id: a.id,
      name: a.name,
      desk: a.desk,
      room: a.room + 1, // 1-based for human readability
      roomName: a.roomName,
      topic: a.topic,
      cwd: a.cwd,
      modelFamily: a.modelFamily,
      model: a.model,
      logDir: join(LOGS_DIR, a.id),
    }));
    atomicWriteFileSync(MANIFEST_FILE, JSON.stringify(manifest, null, 2));
  } catch (err) {
    console.error("Failed to write manifest:", err);
  }
}
