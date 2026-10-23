import { setTimeout as delay } from "node:timers/promises";
import * as AgentManager from "../agent-manager.ts";
import { formatApiTokenDevice } from "../../shared/identity.ts";
import { resolveApiToken, sendApiTokenMessage, drainApiTokenInbox } from "../auth/api-tokens.ts";
import { readTokenLogAfter } from "../auth/api-token-log.ts";
import { canSeeRoom, getUserById } from "../users.ts";
import { projectedAgentsManifest } from "../http/agent-route-helpers.ts";
import { readAgentLogs } from "../agents/log-reader.ts";
import { OfficeToolError, validateArguments } from "./tools.ts";

function identity(raw: string) {
  const token = resolveApiToken(raw);
  if (!token) throw new OfficeToolError("unauthenticated");
  return token;
}

function visibleAgent(raw: string, agentId: string) {
  const token = identity(raw);
  const user = getUserById(token.userId);
  const agent = AgentManager.getAgent(agentId);
  if (!agent) throw new OfficeToolError("agent_not_found");
  const roomId = AgentManager.getRooms()[agent.room]?.id ?? agent.roomId;
  if (!user || !roomId || !canSeeRoom(user, roomId)) throw new OfficeToolError("forbidden");
  return { token, agent, user };
}

export async function callOfficeTool(name: string, args: Record<string, unknown>, raw: string, signal: AbortSignal): Promise<unknown> {
  validateArguments(name, args);
  signal.throwIfAborted();
  const token = identity(raw);
  if (name === "list_agents") {
    const request = new Request("http://localhost/api/agents", { headers: { Authorization: `Bearer ${raw}` } });
    const result = projectedAgentsManifest(request, { kind: "api", token });
    if (result instanceof Response) throw new OfficeToolError("forbidden");
    return { agents: result };
  }
  if (name === "read_replies") return readReplies(raw, args, signal);
  const agentId = args.agentId as string;
  visibleAgent(raw, agentId);
  if (name === "read_conversation") {
    const session = (args.sessionId as string | undefined) ?? AgentManager.getCurrentSessionId(agentId);
    if (!session) return { entries: [], sessionId: null };
    const query = new URLSearchParams({ session, tier: "conversation", limit: String(args.limit ?? 50) });
    if (args.before !== undefined) query.set("before", String(args.before));
    const result = readAgentLogs(agentId, query);
    if (!result.ok) throw new OfficeToolError(result.error);
    return { ...result.body, pendingPrompt: AgentManager.getAgentPendingPrompt(agentId), inFlightTurn: AgentManager.getAgentInFlightTurnForLogs(agentId) };
  }
  const text = args.text as string;
  if (!text.trim()) throw new OfficeToolError("text_required");
  if (text.trimStart().startsWith("/")) throw new OfficeToolError("command_not_allowed");
  const display = AgentManager.getAgentDisplay(agentId);
  if (!display) throw new OfficeToolError("agent_not_found");
  const result = await sendApiTokenMessage(token.tokenId, { targetAgentId: agentId, targetAgentName: display.name, targetRoomName: display.roomName, text }, () => {
    // Token persistence is serialized. Permissions and prompts can change while
    // waiting for that mutex, so recheck inside the synchronous delivery step.
    signal.throwIfAborted();
    const current = visibleAgent(raw, agentId);
    if (AgentManager.getAgentPendingPrompt(agentId)) throw new OfficeToolError("awaits_member_answer");
    return AgentManager.enqueueMessage(agentId, { sender: { kind: "user", username: current.user.name, device: formatApiTokenDevice(current.token.tokenName, current.token.tokenId) }, text });
  });
  if (!result.ok) throw new OfficeToolError(result.error);
  return { messageId: result.messageId };
}

async function readReplies(raw: string, args: Record<string, unknown>, signal: AbortSignal) {
  const after = (args.after as number | undefined) ?? 0;
  const deadline = Date.now() + ((args.waitSeconds as number | undefined) ?? 0) * 1000;
  while (true) {
    signal.throwIfAborted();
    const token = identity(raw);
    const page = readTokenLogAfter(token.tokenId, after);
    if (page.entries.length > 0 || Date.now() >= deadline) {
      const result = await drainApiTokenInbox(token.tokenId, Date.now(), after);
      identity(raw);
      if (!result) throw new OfficeToolError("unauthenticated");
      return result;
    }
    await delay(Math.min(250, deadline - Date.now()), undefined, { signal });
  }
}
