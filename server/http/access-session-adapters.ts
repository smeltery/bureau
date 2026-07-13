import type { ServerMessage } from "../../shared/types.ts";
import { logoutBySessionHash, resolveSessionHashByPrefix, revokeActiveSessionByPrefixForUserId, revokeSessionByPrefix, wouldRevokeLeaveOfficeUnreachable } from "../auth/auth.ts";
import { broadcastToOwners, pushSessionsListToEachWs } from "../access-broadcasts.ts";
import type { SessionRevokeResult } from "./sessions.ts";

export async function revokeSessionForApi(userId: string, role: "owner" | "member", sessionPrefix: string): Promise<SessionRevokeResult> {
  if (role === "owner") {
    const targetHash = resolveSessionHashByPrefix(sessionPrefix);
    if (targetHash && wouldRevokeLeaveOfficeUnreachable(targetHash)) return "would_strand_office";
    const result = await revokeSessionByPrefix(sessionPrefix);
    if (result === "ok") {
      broadcastToOwners({ type: "session_revoked", sessionPrefix } as ServerMessage);
      pushSessionsListToEachWs();
    }
    return result;
  }
  const result = await revokeActiveSessionByPrefixForUserId(sessionPrefix, userId);
  if (result === "ok") pushSessionsListToEachWs();
  return result;
}

export async function logoutSessionForApi(sessionIdHash: string): Promise<SessionRevokeResult> {
  if (wouldRevokeLeaveOfficeUnreachable(sessionIdHash)) return "would_strand_office";
  const ok = await logoutBySessionHash(sessionIdHash);
  if (ok) pushSessionsListToEachWs();
  return ok ? "ok" : "not_found";
}
