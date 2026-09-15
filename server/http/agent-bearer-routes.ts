import * as AgentManager from "../agent-manager.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import { canSeeRoom, getUserById } from "../users.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export async function handleAgentBearerPost(req: Request, parts: string[]): Promise<Response | null> {
  const identity = resolveAgentToken(readBearerToken(req));
  if (!identity && isAgentBearerRoute(req.method, parts)) {
    return new Response(JSON.stringify({ error: "missing or invalid bearer token" }), { status: 401, headers: JSON_HEADERS });
  }
  if (!identity) return null;

  if (req.method === "GET" && parts.length === 3 && parts[2] === "context") {
    const agentId = parts[1]!;
    if (identity.agentId !== agentId) return tokenMismatch();
    return new Response(JSON.stringify(await AgentManager.getAgentContextUsage(agentId)), { headers: JSON_HEADERS });
  }

  if (req.method === "GET" && parts.length === 3 && parts[2] === "instructions") {
    const agentId = parts[1]!;
    const denied = denyInvisibleAgent(identity, agentId);
    if (denied) return denied;
    const instructions = AgentManager.getAgentInstructions(agentId);
    if (!instructions) return jsonError(404, "agent not found");
    return new Response(JSON.stringify(instructions), { headers: JSON_HEADERS });
  }

  if (req.method !== "POST") return null;

  if (parts.length === 3 && parts[2] === "diff") {
    const agentId = parts[1]!;
    if (identity.agentId !== agentId) return tokenMismatch();
    const body = await readOptionalJson(req);
    const dir = typeof body?.dir === "string" ? body.dir : undefined;
    const commit = typeof body?.commit === "string" ? body.commit : undefined;
    const result = AgentManager.emitAgentDiff(agentId, dir, commit);
    if (!result.ok) return jsonError(result.status, result.error);
    return jsonOk();
  }
  if (parts.length === 3 && parts[2] === "edit-file") {
    const agentId = parts[1]!;
    if (identity.agentId !== agentId) return tokenMismatch();
    const path = await readRequiredString(req, "path");
    if (path instanceof Response) return path;
    const result = AgentManager.emitAgentEditFile(agentId, path);
    if (!result.ok) return jsonError(result.status, result.error);
    return jsonOk();
  }
  if (parts.length === 3 && parts[2] === "read-file") {
    const agentId = parts[1]!;
    if (identity.agentId !== agentId) return tokenMismatch();
    const path = await readRequiredString(req, "path");
    if (path instanceof Response) return path;
    const result = AgentManager.emitAgentReadFile(agentId, path);
    if (!result.ok) return jsonError(result.status, result.error);
    return jsonOk();
  }
  if (parts.length === 3 && parts[2] === "preview-url") {
    const agentId = parts[1]!;
    if (identity.agentId !== agentId) return tokenMismatch();
    const body = await readOptionalJson(req);
    if (!body) return jsonError(400, "invalid JSON body");
    const result = await AgentManager.emitAgentPreviewUrl(agentId, body);
    if (!result.ok) return jsonError(result.status, result.error);
    return jsonOk();
  }
  if (parts.length === 3 && parts[2] === "browser") {
    const agentId = parts[1]!;
    if (identity.agentId !== agentId) return tokenMismatch();
    const body = await readOptionalJson(req);
    if (!body) return jsonError(400, "invalid JSON body");
    const result = await AgentManager.emitAgentBrowser(agentId, body);
    if (!result.ok) {
      const payload: Record<string, unknown> = { error: result.error };
      if (result.code) payload.code = result.code;
      return new Response(JSON.stringify(payload), { status: result.status, headers: JSON_HEADERS });
    }
    return new Response(JSON.stringify(result.result), { headers: JSON_HEADERS });
  }
  if (parts.length === 3 && parts[2] === "terminal-command") {
    const agentId = parts[1]!;
    if (identity.agentId !== agentId) return tokenMismatch();
    const command = await readRequiredString(req, "command");
    if (command instanceof Response) return command;
    const result = AgentManager.emitAgentTerminalCommand(agentId, command);
    if (!result.ok) return jsonError(result.status, result.error);
    return jsonOk();
  }
  if (parts.length === 3 && parts[2] === "message") {
    // The sender's identity (name + room) is looked up server-side from
    // senderAgentId so callers can't spoof identity or inject
    // prefix-delimiter characters into the prompt the receiver sees.
    const receiverId = parts[1]!;
    const body = await readOptionalJson(req);
    if (!body) return jsonError(400, "invalid JSON body");
    const text = typeof body.text === "string" ? body.text : null;
    const senderAgentId = typeof body.senderAgentId === "string" ? body.senderAgentId : null;
    if (!text || !senderAgentId) return jsonError(400, "required: text, senderAgentId");
    if (body.steer !== undefined && typeof body.steer !== "boolean") return jsonError(422, "steer must be a boolean");
    if (identity.agentId !== senderAgentId) return jsonError(403, "token does not match senderAgentId");
    if (senderAgentId === receiverId) return jsonError(400, "cannot send to self");
    const senderInfo = AgentManager.getAgentDisplay(senderAgentId);
    if (!senderInfo) return jsonError(400, "senderAgentId is not a known agent");
    const result = AgentManager.enqueueMessage(
      receiverId,
      {
        sender: { kind: "agent", agentId: senderAgentId, agentName: senderInfo.name, roomName: senderInfo.roomName },
        text,
      },
      // Enqueue and interrupt decided in one manager call — see
      // enqueueMessage's opts for why this can't be a second request.
      { steer: body.steer === true },
    );
    if (!result.ok) return jsonError(result.status, result.error);
    return new Response(JSON.stringify(result), { headers: JSON_HEADERS });
  }

  return null;
}

function isAgentBearerRoute(method: string, parts: string[]): boolean {
  if (parts.length !== 3) return false;
  if (method === "GET" && parts[2] === "context") return true;
  if (method === "GET" && parts[2] === "instructions") return true;
  if (method !== "POST") return false;
  return parts[2] === "diff" || parts[2] === "edit-file" || parts[2] === "read-file" || parts[2] === "preview-url" || parts[2] === "browser" || parts[2] === "terminal-command" || parts[2] === "message";
}

async function readOptionalJson(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

async function readRequiredString(req: Request, field: string): Promise<string | Response> {
  const body = await readOptionalJson(req);
  const value = typeof body?.[field] === "string" ? body[field] : "";
  if (!value) return jsonError(400, `missing ${field}`);
  return value;
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}

function jsonOk(): Response {
  return new Response(JSON.stringify({ ok: true }), { headers: JSON_HEADERS });
}

function tokenMismatch(): Response {
  return jsonError(403, "token does not match agent");
}

function denyInvisibleAgent(identity: { agentId: string; userId: string | null }, agentId: string): Response | null {
  const agent = AgentManager.getAgent(agentId);
  if (!agent) return jsonError(404, "agent not found");
  if (!identity.userId) return identity.agentId === agentId ? null : tokenMismatch();
  const user = getUserById(identity.userId);
  const roomId = AgentManager.getRooms()[agent.room]?.id ?? agent.roomId;
  if (!user || !roomId || !canSeeRoom(user, roomId)) return jsonError(403, "forbidden");
  return null;
}
