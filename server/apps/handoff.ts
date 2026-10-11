import * as AgentManager from "../agent-manager.ts";
import { canSeeRoom, getUserById } from "../users.ts";
import type { AppRecord } from "../../shared/apps.ts";
import { jsonError, type AppsIdentity } from "../http/app-route-helpers.ts";

export function validateAppHandoff(value: unknown, app: AppRecord, caller: AppsIdentity): { createdByAgentId?: string } | Response {
  if (value === undefined) return {};
  if (typeof value !== "string" || !value.trim()) return jsonError(400, "invalid_request", "createdByAgentId must name a live agent");
  const target = AgentManager.getAgent(value);
  const roomId = target ? AgentManager.getRooms()[target.room]?.id : undefined;
  if (!target || !roomId) return jsonError(404, "not_found", "target agent not found");
  const callerUser = caller.scope === "loopback" ? null : caller.userId ? getUserById(caller.userId) : null;
  const owner = app.userId ? getUserById(app.userId) : null;
  const callerAllowed = caller.scope === "loopback" || (callerUser && canSeeRoom(callerUser, roomId));
  const ownerAllowed = app.userId === null || (owner && canSeeRoom(owner, roomId));
  if (!callerAllowed || !ownerAllowed) return jsonError(404, "not_found", "target agent not found");
  return { createdByAgentId: target.id };
}
