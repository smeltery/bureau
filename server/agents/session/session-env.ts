import { readEnvFile } from "../../persistence.ts";
import { getUserById } from "../../users.ts";
import { getAgentToken } from "../tokens.ts";
import { officeConfig, rooms, type ManagedAgent } from "../state.ts";

// Merge process.env with office, room, and user env files.
// User overrides room, room overrides office, office overrides process.env.
// Spawn-time failure mode: if a configured env file is missing or fails to
// parse, throw; callers surface the error to the agent log.
export function buildSessionEnv(managed: Pick<ManagedAgent, "info">): { [key: string]: string | undefined } | undefined {
  const room = rooms[managed.info.room];
  const roomEnvFile = room?.envFile ?? null;
  const officeEnvFile = officeConfig.envFile;
  const userEnvFile = managed.info.userId ? (getUserById(managed.info.userId)?.envFile ?? null) : null;
  const agentToken = getAgentToken(managed.info.id);
  if (!roomEnvFile && !officeEnvFile && !userEnvFile && !agentToken) return undefined;

  // Intentional: inherit parent process.env so agents see HOME/PATH/etc.
  // Office, room, and user files override individual keys but cannot unset
  // inherited ones.
  const merged: { [key: string]: string | undefined } = { ...process.env };
  if (officeEnvFile) {
    const officeEnv = readEnvFile(officeEnvFile);
    Object.assign(merged, officeEnv);
  }
  if (roomEnvFile) {
    const roomEnv = readEnvFile(roomEnvFile);
    Object.assign(merged, roomEnv);
  }
  if (userEnvFile) {
    const userEnv = readEnvFile(userEnvFile);
    Object.assign(merged, userEnv);
  }
  if (agentToken) merged.BUREAU_AGENT_TOKEN = agentToken;
  return merged;
}
