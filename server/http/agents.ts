import * as AgentManager from "../agent-manager.ts";
import { readBearerToken, resolveAgentToken } from "../agents/tokens.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import type { Attachment } from "../../shared/types.ts";
import { canSeeRoom, getUserById } from "../users.ts";
import { cancelScheduledMessage, listScheduledMessages, parseDeliverAt, scheduleAgentMessage } from "../scheduled-messages.ts";
import { handleAgentBearerPost } from "./agent-bearer-routes.ts";
import { handleAgentManagementRequest } from "./agent-management-routes.ts";
import { handleAgentSpawnRequest } from "./agent-spawn-route.ts";
import { agentRouteParts, JSON_HEADERS, jsonError, projectedAgentsManifest, readJsonBody, requireAgentAccessAllowingPrivileged, requireUserAgentAccess, sessionUser } from "./agent-route-helpers.ts";
import { readAgentLogs, requiresIsolatedLogSearch } from "../agents/log-reader.ts";
import { readAgentLogsIsolated } from "../agents/log-search-runner.ts";

/**
 * Handle agent-scoped HTTP routes:
 *   GET  /api/agents                     — list the caller-visible agent discovery manifest.
 *   POST /api/agents                     — spawn an agent.
 *   DELETE /api/agents/:id               — kill an agent.
 *   PATCH /api/agents/:id                — edit agent metadata/session settings.
 *   POST /api/agents/:id/revive          — revive a killed agent.
 *   POST /api/agents/:id/abort           — abort the active agent run.
 *   PUT  /api/agents/:id/privileged      — toggle privileged agent tokens.
 *   POST /api/agents/:id/move            — move an agent to another room.
 *   PUT  /api/agents/:id/topic           — set an agent topic.
 *   DELETE /api/agents/:id/topic         — reset an agent topic.
 *   POST /api/agents/:id/diff             — emit a styled diff card (optional body: { dir, commit }).
 *   POST /api/agents/:id/edit-file        — emit an [Open in editor] card (body: { path }).
 *   POST /api/agents/:id/read-file        — copy a file into the agent's files dir and
 *                                           emit a `file-view` card (body: { path }).
 *   POST /api/agents/:id/terminal-command — emit a [Copy to terminal] card (body: { command }).
 *   POST /api/agents/:id/message          — queue an agent-to-agent message into the
 *                                           receiver's chat (body: { text, senderAgentId }).
 *   POST /api/agents/:id/messages         — send a user or bearer agent message.
 *   GET  /api/agents/:id/scheduled-messages — list pending messages scheduled by an agent.
 *   DELETE /api/agents/:id/scheduled-messages/:msg — cancel a pending scheduled message.
 *   PATCH /api/agents/:id/messages/:entry — edit a prior user message.
 *   GET  /api/agents/:id/logs             — index, search, or retrieve persisted logs.
 *   GET  /api/agents/:id/subscription-usage — read the account's plan-allowance usage.
 *   GET  /api/agents/:id/sessions         — list resumable sessions.
 *   POST /api/agents/:id/resume           — resume a session.
 *   POST /api/agents/:id/new-conversation — start a fresh session.
 *   POST /api/agents/:id/send-now         — flush queued messages.
 *   DELETE /api/agents/:id/queue/:msg     — drop a queued message.
 *
 * Returns null for any other URL so the caller can fall through.
 */
export async function handleAgentsRequest(req: Request, url: URL, auth?: AuthResult): Promise<Response | null> {
  const parts = agentRouteParts(url.pathname);
  if (!parts) return null;
  if (isRetiredLegacyAgentAffordance(url.pathname, parts, req.method)) return null;

  if (parts[0] === "agents" && parts.length === 1 && req.method === "POST") {
    return handleAgentSpawnRequest(req, auth);
  }

  if (parts[0] === "agents" && parts.length === 1 && req.method === "GET") {
    const manifest = projectedAgentsManifest(req, auth);
    if (manifest instanceof Response) return manifest;
    return new Response(JSON.stringify(manifest, null, 2), { headers: JSON_HEADERS });
  }

  if (parts[0] === "agents" && parts.length >= 2) {
    const agentId = parts[1]!;
    const managementResponse = await handleAgentManagementRequest(req, parts, agentId, auth);
    if (managementResponse) return managementResponse;

    if (req.method === "GET" && parts.length === 3 && parts[2] === "logs") {
      const denied = requireAgentLogAccess(req, auth, agentId);
      if (denied) return denied;
      const result = requiresIsolatedLogSearch(url.searchParams) ? await readAgentLogsIsolated(agentId, url.searchParams) : readAgentLogs(agentId, url.searchParams);
      if (!result.ok) return jsonError(result.status, result.error);
      const inFlightTurn = AgentManager.getAgentInFlightTurnForLogs(agentId);
      return new Response(JSON.stringify(result.body.mode === "search" ? result.body : { ...result.body, inFlightTurn }), { headers: JSON_HEADERS });
    }

    if (req.method === "PATCH" && parts.length === 4 && parts[2] === "messages") {
      const denied = requireUserAgentAccess(auth, agentId);
      if (denied) return denied;
      const body = await readJsonBody(req);
      const newText = typeof body?.newText === "string" ? body.newText : "";
      if (!newText) return jsonError(422, "newText is required");
      const username = sessionUser(auth)?.name;
      void AgentManager.editMessage(agentId, parts[3]!, newText, username);
      return new Response(JSON.stringify({ messageId: "" }), { headers: JSON_HEADERS });
    }

    // Steering another agent's conversation — dequeue / resume /
    // new-conversation / send-now — is the second half of a privileged agent's
    // office authority, scoped to the agents its manager can see. Note this is
    // NOT the same as sending as another agent: the message routes below keep
    // their own sender rules, so a privileged agent still speaks only as itself.
    if (req.method === "DELETE" && parts.length === 4 && parts[2] === "queue") {
      const denied = requireAgentAccessAllowingPrivileged(req, auth, agentId);
      if (denied) return denied;
      AgentManager.dequeueMessage(agentId, parts[3]!);
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (req.method === "GET" && parts.length === 3 && parts[2] === "scheduled-messages") {
      const rawBearer = readBearerToken(req);
      const bearer = resolveAgentToken(rawBearer);
      if (rawBearer && !bearer) return jsonError(401, "missing or invalid bearer token");
      if (bearer) {
        if (bearer.agentId !== agentId) return jsonError(403, "token does not match agent");
      } else {
        const denied = requireUserAgentAccess(auth, agentId);
        if (denied) return denied;
      }
      return new Response(JSON.stringify({ scheduled: listScheduledMessages(agentId) }), { headers: JSON_HEADERS });
    }

    if (req.method === "DELETE" && parts.length === 4 && parts[2] === "scheduled-messages") {
      const rawBearer = readBearerToken(req);
      const bearer = resolveAgentToken(rawBearer);
      if (rawBearer && !bearer) return jsonError(401, "missing or invalid bearer token");
      if (bearer) {
        if (bearer.agentId !== agentId) return jsonError(403, "token does not match agent");
      } else {
        const denied = requireUserAgentAccess(auth, agentId);
        if (denied) return denied;
      }
      if (!cancelScheduledMessage(agentId, parts[3]!)) return jsonError(404, "scheduled message not found");
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (req.method === "POST" && parts.length === 3 && parts[2] === "messages") {
      const body = await readJsonBody(req);
      const text = typeof body?.text === "string" ? body.text : "";
      const malformedFields = malformedMessageFields(body);
      if (malformedFields) return malformedFields;
      if (!text && !Array.isArray(body?.attachments)) return jsonError(400, "text is required");
      const deliverAtRaw = body?.deliverAt;
      const rawBearer = readBearerToken(req);
      const bearer = resolveAgentToken(rawBearer);
      if (rawBearer && !bearer) return jsonError(401, "missing or invalid bearer token");
      if (bearer) {
        if (body?.sendNow !== undefined) return jsonError(400, "sendNow is only supported for user senders");
        if (!text) return jsonError(400, "text is required");
        const deliverAt = typeof deliverAtRaw === "string" ? parseDeliverAt(deliverAtRaw) : null;
        if (deliverAtRaw !== undefined) {
          // A scheduled steer would have to decide, minutes or days later,
          // whether interrupting is still what the sender wanted. Refused
          // rather than silently dropping one of the two flags.
          if (body?.steer !== undefined) return jsonError(400, "steer cannot be combined with deliverAt; a scheduled message is always delivered as a plain queue");
          if (typeof deliverAtRaw !== "string" || deliverAt === null) return jsonError(400, "deliverAt must be RFC3339 with a timezone");
          const result = scheduleAgentMessage({
            senderAgentId: bearer.agentId,
            receiverAgentId: agentId,
            text,
            deliverAt,
            clientMessageId: typeof body?.clientMessageId === "string" ? body.clientMessageId : undefined,
          });
          if (!result.ok) return jsonError(result.status, result.error);
          return new Response(JSON.stringify({ scheduledId: result.entry.id, deliverAt: new Date(result.entry.deliverAt).toISOString() }), { headers: JSON_HEADERS });
        }
        if (bearer.agentId === agentId) return jsonError(400, "cannot send to self");
        const senderInfo = AgentManager.getAgentDisplay(bearer.agentId);
        if (!senderInfo) return jsonError(400, "sender agent is not known");
        const result = AgentManager.enqueueMessage(
          agentId,
          {
            sender: { kind: "agent", agentId: bearer.agentId, agentName: senderInfo.name, roomName: senderInfo.roomName },
            text,
            clientMessageId: typeof body?.clientMessageId === "string" ? body.clientMessageId : undefined,
          },
          // Enqueue and interrupt decided in one manager call — see
          // enqueueMessage's opts for why this can't be a second request.
          { steer: body?.steer === true },
        );
        if (!result.ok) return jsonError(result.status, result.error);
        // `queued` tells the sender whether the receiver reads this now or
        // after their current turn: true = parked behind the in-flight turn.
        // `steered` / `steerDeclined` appear only when the send asked to
        // steer: steered:true = a turn was interrupted for this message;
        // steered:false with no reason = there was no turn to interrupt;
        // steerDeclined = a guard rail refused, and the message is queued.
        return new Response(
          JSON.stringify({
            messageId: result.messageId,
            queued: result.queued,
            ...(result.steered === undefined ? {} : { steered: result.steered }),
            ...(result.steerDeclined === undefined ? {} : { steerDeclined: result.steerDeclined }),
          }),
          { headers: JSON_HEADERS },
        );
      }
      if (deliverAtRaw !== undefined) return jsonError(400, "deliverAt is only supported for agent bearer messages");
      // steer is the mirror image of sendNow: agent-branch only. A user with
      // the same intent has sendNow, which is not rate-limited and not refused
      // mid multi-step flow — a person deciding to interrupt their own agent
      // is not what the steer guard rails protect against.
      if (body?.steer !== undefined) return jsonError(400, "steer is only supported for agent senders; user senders pass sendNow");
      const denied = requireUserAgentAccess(auth, agentId);
      if (denied) return denied;
      const username = sessionUser(auth)?.name;
      const userId = auth?.kind === "ok" ? auth.session.userId : null;
      const attachments = Array.isArray(body?.attachments) ? (body.attachments as Attachment[]) : undefined;
      const send = AgentManager.sendMessage(agentId, text, username, attachments, userId);
      if (body?.sendNow === true) {
        void send.then(() => AgentManager.sendNow(agentId));
      }
      return new Response(JSON.stringify({ messageId: "" }), { headers: JSON_HEADERS });
    }

    if (req.method === "POST" && parts.length === 3 && parts[2] === "resume") {
      const denied = requireAgentAccessAllowingPrivileged(req, auth, agentId);
      if (denied) return denied;
      const body = await readJsonBody(req);
      const sessionId = typeof body?.sessionId === "string" ? body.sessionId : "";
      if (!sessionId) return jsonError(422, "sessionId is required");
      void AgentManager.resume(agentId, sessionId);
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (req.method === "POST" && parts.length === 3 && parts[2] === "new-conversation") {
      const denied = requireAgentAccessAllowingPrivileged(req, auth, agentId);
      if (denied) return denied;
      void AgentManager.newConversation(agentId);
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }

    if (req.method === "POST" && parts.length === 3 && parts[2] === "send-now") {
      const denied = requireAgentAccessAllowingPrivileged(req, auth, agentId);
      if (denied) return denied;
      void AgentManager.sendNow(agentId);
      return new Response(null, { status: 204, headers: JSON_HEADERS });
    }
  }

  const bearerResponse = await handleAgentBearerPost(req, parts);
  if (bearerResponse) return bearerResponse;

  return null;
}

// The read rule for an agent's conversation: a session that can see the agent's
// room, or a bearer token belonging either to the agent itself or to a user who
// can. Exported because Slide Mode reads the SAME conversation through a
// different surface (server/http/agent-slides.ts) and the two must not drift.
export function requireAgentLogAccess(req: Request, auth: AuthResult | undefined, agentId: string): Response | null {
  const rawBearer = readBearerToken(req);
  const bearer = resolveAgentToken(rawBearer);
  if (rawBearer && !bearer) return jsonError(401, "missing or invalid bearer token");

  const agent = AgentManager.getAgent(agentId);
  if (!agent) return requireKilledAgentLogAccess(auth, bearer, agentId);
  if (!bearer) return requireUserAgentAccess(auth, agentId);
  if (bearer.agentId === agentId) return null;
  if (!bearer.userId) return jsonError(403, "forbidden");
  const user = getUserById(bearer.userId);
  const roomId = AgentManager.getRooms()[agent.room]?.id;
  if (!user || !roomId || !canSeeRoom(user, roomId)) return jsonError(403, "forbidden");
  return null;
}

function requireKilledAgentLogAccess(auth: AuthResult | undefined, bearer: ReturnType<typeof resolveAgentToken>, agentId: string): Response | null {
  const managerUserId = AgentManager.killedAgentManagerUserId(agentId);
  if (managerUserId === null) return jsonError(404, "agent not found");

  if (bearer) {
    if (!bearer.userId) return jsonError(403, "forbidden");
    const user = getUserById(bearer.userId);
    if (user?.role === "owner" || bearer.userId === managerUserId) return null;
    return jsonError(403, "forbidden");
  }

  if (auth?.kind === "loopback") return null;
  const user = sessionUser(auth);
  if (!user) return jsonError(401, "unauthenticated");
  if (user.role === "owner" || user.id === managerUserId) return null;
  return jsonError(403, "forbidden");
}

function malformedMessageFields(body: Record<string, unknown> | null): Response | null {
  if (!body) return null;
  if (body.attachments !== undefined) {
    if (!Array.isArray(body.attachments)) return jsonError(422, "attachments must be an array");
    if (body.attachments.some(isMalformedAttachment)) return jsonError(422, "attachments must contain filename, originalName, mediaType strings and nonnegative integer size");
  }
  if (body.clientMessageId !== undefined && typeof body.clientMessageId !== "string") return jsonError(422, "clientMessageId must be a string");
  if (body.deliverAt !== undefined && typeof body.deliverAt !== "string") return jsonError(422, "deliverAt must be a string");
  if (body.sendNow !== undefined && typeof body.sendNow !== "boolean") return jsonError(422, "sendNow must be a boolean");
  if (body.steer !== undefined && typeof body.steer !== "boolean") return jsonError(422, "steer must be a boolean");
  return null;
}

function isMalformedAttachment(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return true;
  const attachment = value as Partial<Attachment>;
  const size = attachment.size;
  return (
    typeof attachment.filename !== "string" ||
    attachment.filename.trim() === "" ||
    typeof attachment.originalName !== "string" ||
    attachment.originalName.trim() === "" ||
    typeof attachment.mediaType !== "string" ||
    attachment.mediaType.trim() === "" ||
    typeof size !== "number" ||
    !Number.isSafeInteger(size) ||
    size < 0
  );
}

function isRetiredLegacyAgentAffordance(pathname: string, parts: string[], method: string): boolean {
  if (!pathname.startsWith("/agents/")) return false;
  if (method !== "POST") return false;
  if (parts.length !== 3) return false;
  return parts[2] === "diff" || parts[2] === "edit-file" || parts[2] === "read-file" || parts[2] === "terminal-command" || parts[2] === "message";
}
