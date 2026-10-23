import type { ServerMessage } from "../../shared/types.ts";
import { logoutBySessionHash, revokeActiveSessionByPrefixForUserId, revokeSessionByPrefix } from "../auth/auth.ts";
import { broadcastToOwners, pushSessionsListToEachWs } from "../access-broadcasts.ts";
import type { SessionRevokeResult } from "./sessions.ts";

export async function revokeSessionForApi(userId: string, role: "owner" | "member", sessionPrefix: string): Promise<SessionRevokeResult> {
  if (role === "owner") {
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
  const result = await logoutBySessionHash(sessionIdHash);
  if (result === "ok") pushSessionsListToEachWs();
  return result;
}
