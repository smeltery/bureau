import * as AgentManager from "../agent-manager.ts";
import { findCronjob } from "./cronjob-store.ts";
import { resolveRunToken } from "./tokens.ts";
import { canSeeRoom, getUserById } from "../users.ts";
import type { AgentInfo, UserRecord } from "../../shared/types.ts";

export type CronRunIdentity = { cronjobId: string; runId: string; userId: string | null };

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}

/** Resolve a cron-run bearer, or null when the token is not a live run token. */
export function resolveCronRunBearer(rawBearer: string | null): CronRunIdentity | null {
  return resolveRunToken(rawBearer);
}

/**
 * Creator visibility for a cron run: the job must still exist, still name a
 * living creator, and that creator must be able to see the target agent's room.
 * Unknown and inaccessible targets share one denial so a probe cannot tell them
 * apart.
 */
export function denyCronRunAgentAccess(run: CronRunIdentity, agentId: string): Response | null {
  const access = cronRunCreatorAccess(run);
  if (!access) return jsonError(403, "forbidden");
  const agent = AgentManager.getAgent(agentId);
  if (!agent) return jsonError(403, "forbidden");
  const roomId = AgentManager.getRooms()[agent.room]?.id ?? agent.roomId;
  if (!roomId || !canSeeRoom(access.creator, roomId)) return jsonError(403, "forbidden");
  return null;
}

export function projectAgentsForCronRun(run: CronRunIdentity, rooms: { id: string }[]): AgentInfo[] | Response {
  const access = cronRunCreatorAccess(run);
  if (!access) return jsonError(403, "forbidden");
  return AgentManager.getAllAgents().filter((agent) => {
    const roomId = rooms[agent.room]?.id ?? agent.roomId;
    return !!roomId && canSeeRoom(access.creator, roomId);
  });
}

export function cronRunMessageControlsError(body: Record<string, unknown> | null): Response | null {
  if (!body) return null;
  if (body.sendNow !== undefined) return jsonError(400, "sendNow is only supported for user senders");
  if (body.steer !== undefined) return jsonError(400, "steer is only supported for agent senders");
  if (body.deliverAt !== undefined) return jsonError(400, "deliverAt is only supported for agent bearer messages");
  if (body.attachments !== undefined) return jsonError(400, "attachments are not supported for cron-run senders");
  if (body.senderAgentId !== undefined) return jsonError(400, "senderAgentId is not supported for cron-run senders");
  return null;
}

export function enqueueCronRunMessage(
  run: CronRunIdentity,
  receiverId: string,
  text: string,
  clientMessageId?: string,
): { ok: true; messageId: string; queued: boolean } | { ok: false; status: number; error: string } {
  if (!cronRunCreatorAccess(run)) return { ok: false, status: 403, error: "forbidden" };
  const denied = denyCronRunAgentAccess(run, receiverId);
  if (denied) return { ok: false, status: 403, error: "forbidden" };
  const job = findCronjob(run.cronjobId)!;
  const result = AgentManager.enqueueMessage(receiverId, {
    sender: { kind: "cronjob", cronjobId: job.id, cronjobName: job.name },
    text,
    ...(clientMessageId ? { clientMessageId } : {}),
  });
  if (!result.ok) return { ok: false, status: result.status, error: result.error };
  return { ok: true, messageId: result.messageId, queued: result.queued };
}

/** Handle POST /api/agents/:id/messages for a cron-run bearer. */
export function handleCronRunAgentMessage(run: CronRunIdentity, agentId: string, body: Record<string, unknown> | null, text: string): Response {
  const controls = cronRunMessageControlsError(body);
  if (controls) return controls;
  if (!text) return jsonError(400, "text is required");
  const result = enqueueCronRunMessage(run, agentId, text, typeof body?.clientMessageId === "string" ? body.clientMessageId : undefined);
  if (!result.ok) return jsonError(result.status, result.error);
  return new Response(JSON.stringify({ messageId: result.messageId, queued: result.queued }), { status: 200, headers: JSON_HEADERS });
}

function cronRunCreatorAccess(run: CronRunIdentity): { job: NonNullable<ReturnType<typeof findCronjob>>; creator: UserRecord } | null {
  const job = findCronjob(run.cronjobId);
  if (!job) return null;
  // Token userId and job.userId must agree on a living creator. Unowned jobs
  // and tokens minted without a user cannot alert desk agents.
  if (!run.userId || !job.userId || run.userId !== job.userId) return null;
  const creator = getUserById(job.userId);
  if (!creator) return null;
  return { job, creator };
}
