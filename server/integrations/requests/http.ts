import type { AuthResult } from "../../auth/auth-middleware.ts";
import { readBearerToken, resolveAgentToken } from "../../agents/tokens.ts";
import { agents, rooms, addLogEntry } from "../../agents/state.ts";
import { enqueueMessage } from "../../agents/conversation/message-queue.ts";
import { canSeeRoom, getUserById } from "../../users.ts";
import { IntegrationValidationError } from "../../../shared/integrations/connections.ts";
import { integrationActor } from "../access.ts";
import { integrationStore } from "../store.ts";
import { notifyIntegrationChange } from "../changes.ts";
import { recordAuditEvent } from "../../audit/store.ts";
import { createSecretRequests, SecretRequestError } from "./store.ts";

export const secretRequests = createSecretRequests({
  store: integrationStore,
  agent: (id) => {
    const agent = agents.get(id);
    return agent ? { userId: agent.info.userId ?? null, sessionId: agent.sessionId } : undefined;
  },
  emit: (card) => {
    addLogEntry(card.agentId, "system", `Credential requested: ${card.name}`, { secretRequest: card });
  },
  changed: notifyIntegrationChange,
  settled: (card, status, username) => {
    const text =
      status === "saved"
        ? `The ${card.name} credential was saved through the masked form. Use its configured stand-in on the approved hosts; the value was not sent in chat.`
        : `The request for ${card.name} was declined. Continue without it or explain what is blocked; do not search for credentials.`;
    addLogEntry(card.agentId, "system", `Credential request ${status}: ${card.name}`);
    return enqueueMessage(card.agentId, { sender: { kind: "user", username }, text, clientMessageId: `secret-request-${card.id}` }).ok;
  },
});
const json = (body: unknown, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export async function handleSecretRequests(req: Request, url: URL, auth: AuthResult): Promise<Response | null> {
  const match = /^\/api\/integrations\/requests(?:\/([a-f0-9-]{36}))?$/.exec(url.pathname);
  if (!match) return null;
  try {
    const identity = resolveAgentToken(readBearerToken(req));
    const actor = integrationActor(req, auth);
    if (!identity && !actor) return json({ error: "Authentication required." }, 401);
    if (req.method === "POST" && !match[1]) {
      if (!identity || !agents.has(identity.agentId) || (identity.userId && !getUserById(identity.userId))) return json({ error: "An agent bearer is required to request a credential." }, 403);
      const body = await requestBody(req);
      const latest = resolveAgentToken(readBearerToken(req));
      if (!latest || latest.agentId !== identity.agentId || latest.userId !== identity.userId || (latest.userId && !getUserById(latest.userId))) return json({ error: "Agent access changed." }, 403);
      const card = secretRequests.open(identity.agentId, body);
      recordAuditEvent(`integrations/requests/${card.id}`, ["request"]);
      return json({ requestId: card.id });
    }
    if (!match[1] && req.method === "GET") {
      if (auth.kind !== "ok" || !actor || actor.agent) return json({ error: "A browser session is required." }, 401);
      const requests = secretRequests.listPending().filter((card) => {
        const agent = agents.get(card.agentId),
          room = agent && rooms[agent.info.room];
        return !!room && canSeeRoom(actor.user, room.id) && (card.scope.kind === "office" ? actor.user.role === "owner" : card.scope.userId === actor.user.id);
      });
      return json({ requests });
    }
    if (!match[1]) return json({ error: "Method not allowed." }, 405);
    const { card, status } = secretRequests.get(match[1]);
    const agent = agents.get(card.agentId);
    const room = agent ? rooms[agent.info.room] : null;
    const visible = identity ? identity.agentId === card.agentId : !!actor && !!room && canSeeRoom(actor.user, room.id);
    if (!visible) return json({ error: "Credential request not found." }, 404);
    const canAnswer = !identity && !!actor && !actor.agent && (card.scope.kind === "office" ? actor.user.role === "owner" : actor.user.id === card.scope.userId);
    if (req.method === "GET") return json({ status, canAnswer });
    if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);
    if (!canAnswer || !actor) return json({ error: "Only the responsible member can answer this credential request." }, 403);
    const body = await requestBody(req);
    const authorized = () => {
      const current = integrationActor(req, auth);
      const currentAgent = agents.get(card.agentId);
      const currentRoom = currentAgent ? rooms[currentAgent.info.room] : null;
      return (
        !!current &&
        !current.agent &&
        current.user.id === actor.user.id &&
        !!currentRoom &&
        canSeeRoom(current.user, currentRoom.id) &&
        (card.scope.kind === "office" ? current.user.role === "owner" : current.user.id === card.scope.userId)
      );
    };
    const result = await secretRequests.answer(card.id, { userId: actor.user.id, username: actor.user.name, owner: actor.user.role === "owner" }, body, authorized);
    recordAuditEvent(`integrations/requests/${card.id}`, [result.status]);
    return json(result);
  } catch (error) {
    if (error instanceof SecretRequestError) return json({ error: error.message }, error.status);
    if (error instanceof IntegrationValidationError) return json({ error: error.message }, 400);
    return json({ error: "The credential request could not be completed." }, 500);
  }
}
async function requestBody(req: Request): Promise<Record<string, unknown>> {
  const text = await req.text();
  if (Buffer.byteLength(text) > 32 * 1024) throw new SecretRequestError("Credential request is too large.", 413);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    throw new SecretRequestError("Invalid JSON object.");
  }
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new SecretRequestError("Provide a JSON object.");
  return body as Record<string, unknown>;
}
