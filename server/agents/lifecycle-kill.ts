import { loadAgentHistory, saveAgentHistory } from "../persistence.ts";
import { agents, emit, logCache, persistAll, rooms as roomList } from "./state.ts";
import { sidecarSend } from "./terminal.ts";
import { revokeAgentToken } from "./tokens.ts";
import { buildKilledAgentSummary } from "./revive.ts";

export async function kill(agentId: string) {
  const managed = agents.get(agentId);
  if (!managed) return;
  // Stamp the history entry with killedAt + a full config snapshot BEFORE
  // removing the agent from the live map. After deletion, updateAgentHistory
  // (run by persistAll below) skips this entry because it iterates live
  // agents only, so this write is the authoritative kill-time snapshot the
  // revive chip rehydrates from.
  const killedSummary = buildKilledAgentSummary(agentId, managed);
  {
    const room = roomList[managed.info.room];
    if (room) {
      const history = loadAgentHistory();
      history[agentId] = {
        name: managed.info.name,
        userId: managed.info.userId ?? null,
        lastRoomId: room.id,
        lastRoomName: room.name,
        killedAt: Date.now(),
        cwd: managed.info.cwd,
        outfit: managed.info.outfit,
        permissionMode: managed.info.permissionMode,
        modelFamily: managed.info.modelFamily,
        effort: managed.info.effort,
        agentType: managed.info.agentType,
        privileged: managed.info.privileged ?? false,
        codexSandbox: managed.info.codexSandbox,
        lastSessionId: managed.sessionId,
        topic: managed.info.topic,
        customInstructions: managed.info.customInstructions,
      };
      saveAgentHistory(history);
    }
  }
  // Bump the cancel token so any concurrent runAgentTurn that hasn't yet
  // installed pendingTurn (pre-send plugin retrieval) bails on its next
  // await checkpoint instead of calling session.send on a dying session.
  managed.turnCancelToken++;
  if (managed.pendingPermission) {
    managed.pendingPermission = null;
  }
  managed.queuedPermissions = [];
  const turn = managed.pendingTurn;
  managed.pendingTurn = null;
  if (turn) {
    try {
      turn.reject(new Error("Agent killed."));
    } catch {}
  }
  const oldConsumer = managed.consumerPromise;
  try {
    managed.session?.close();
  } catch {}
  managed.session = null;
  // Remove from the map so the consumer's outer `agents.has(agentId)` guard exits.
  agents.delete(agentId);
  revokeAgentToken(agentId);
  logCache.delete(agentId);
  if (oldConsumer) {
    try {
      await oldConsumer;
    } catch {}
  }
  try {
    sidecarSend(managed, { type: "kill" });
    managed.ptySidecar?.kill();
  } catch {}
  emit({ type: "agent_removed", agentId });
  persistAll();
  if (killedSummary) {
    emit({ type: "killed_agent_added", agent: killedSummary });
  }
}
