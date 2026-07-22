import type { ServerWebSocket } from "bun";
import type { ClientCommand, ServerMessage } from "../../shared/types.ts";
import { getSessionContext, getWsUser } from "../users.ts";
import {
  buildPublicOrigin,
  logoutBySessionHash,
  mintInvite,
  resolveSessionHashByPrefix,
  revokeActiveSessionByPrefixForUserId,
  revokeInviteByPrefix,
  revokeOutstandingInviteByPrefixForUsername,
  revokeSessionByPrefix,
  wouldRevokeLeaveOfficeUnreachable,
} from "../auth/auth.ts";
import { handleAccessSettingsCommand } from "./access-settings-commands.ts";
import { broadcastToOwners, pushInvitesListToEachWs, pushSessionsListToEachWs, sendInvitesListToWs, sendSessionsListToWs } from "../access-broadcasts.ts";

export async function handleAccessCommand(cmd: ClientCommand, ws: ServerWebSocket<unknown>): Promise<boolean> {
  switch (cmd.type) {
    case "list_active_sessions": {
      const user = getWsUser(ws);
      if (!user) {
        ws.send(JSON.stringify({ type: "sessions_active_list", sessions: [] } as ServerMessage));
        return true;
      }
      sendSessionsListToWs(ws);
      return true;
    }
    case "revoke_session": {
      const user = getWsUser(ws);
      if (!user) return true;
      const lockoutReason = "Refused: this is the last active owner session in the office. " + "Mint an additional invite for an owner first, accept it on " + "another device, then retry.";
      if (user.role === "owner") {
        const targetHash = resolveSessionHashByPrefix(cmd.sessionPrefix);
        if (targetHash && wouldRevokeLeaveOfficeUnreachable(targetHash)) {
          ws.send(
            JSON.stringify({
              type: "revoke_blocked",
              sessionPrefix: cmd.sessionPrefix,
              reason: lockoutReason,
            } as ServerMessage),
          );
          return true;
        }
        const result = await revokeSessionByPrefix(cmd.sessionPrefix);
        if (result === "ok") {
          broadcastToOwners({ type: "session_revoked", sessionPrefix: cmd.sessionPrefix });
          pushSessionsListToEachWs();
        } else if (result === "ambiguous") {
          console.warn(`[auth] ambiguous session prefix ${cmd.sessionPrefix} — refused revoke`);
        }
        return true;
      }
      const result = await revokeActiveSessionByPrefixForUserId(cmd.sessionPrefix, user.id);
      if (result === "would_strand_office") {
        ws.send(
          JSON.stringify({
            type: "revoke_blocked",
            sessionPrefix: cmd.sessionPrefix,
            reason: lockoutReason,
          } as ServerMessage),
        );
      } else if (result === "ok") {
        pushSessionsListToEachWs();
      } else if (result === "ambiguous") {
        console.warn(`[auth] ambiguous session prefix ${cmd.sessionPrefix} — refused revoke`);
      }
      return true;
    }
    case "logout": {
      const user = getWsUser(ws);
      const sessionHash = getSessionContext(ws)?.currentSessionPrefix ? resolveSessionHashByPrefix(getSessionContext(ws)!.currentSessionPrefix) : null;
      if (user && sessionHash && wouldRevokeLeaveOfficeUnreachable(sessionHash)) {
        ws.send(
          JSON.stringify({
            type: "revoke_blocked",
            sessionPrefix: getSessionContext(ws)!.currentSessionPrefix,
            reason: "Sign out refused: this is the last active owner session in the office. " + "Mint an additional invite for yourself and accept it on another device first, then retry.",
          } as ServerMessage),
        );
        return true;
      }
      if (sessionHash) await logoutBySessionHash(sessionHash);
      ws.send(JSON.stringify({ type: "session_context", context: null } as ServerMessage));
      return true;
    }
    case "list_invites": {
      const user = getWsUser(ws);
      if (!user) return true;
      sendInvitesListToWs(ws);
      return true;
    }
    case "mint_invite": {
      const user = getWsUser(ws);
      if (!user || user.role !== "owner") {
        ws.send(
          JSON.stringify({
            type: "invite_minted",
            requestId: cmd.requestId,
            ok: false,
            error: "Only owners can mint invites. Use mint_self_invite to add another of your own devices.",
          } as ServerMessage),
        );
        return true;
      }
      const result = await mintInvite({
        username: cmd.username,
        role: cmd.role,
        createdBy: user.name,
        allowExisting: !!cmd.allowExisting,
        ...(cmd.allowedRooms !== undefined ? { allowedRooms: cmd.allowedRooms } : {}),
      });
      if (!result.ok) {
        ws.send(
          JSON.stringify({
            type: "invite_minted",
            requestId: cmd.requestId,
            ok: false,
            error: result.error,
          } as ServerMessage),
        );
        return true;
      }
      const { origin } = buildPublicOrigin();
      ws.send(
        JSON.stringify({
          type: "invite_minted",
          requestId: cmd.requestId,
          ok: true,
          url: `${origin}/i/${result.rawToken}`,
          invite: {
            tokenPrefix: result.invite.tokenPrefix,
            username: result.invite.username,
            role: result.invite.role,
            createdBy: result.invite.createdBy,
            createdAt: result.invite.createdAt,
            expiresAt: result.invite.expiresAt,
            ...(result.invite.allowedRooms ? { allowedRooms: result.invite.allowedRooms } : {}),
          },
        } as ServerMessage),
      );
      pushInvitesListToEachWs();
      return true;
    }
    case "mint_self_invite": {
      const user = getWsUser(ws);
      if (!user) {
        ws.send(
          JSON.stringify({
            type: "invite_minted",
            requestId: cmd.requestId,
            ok: false,
            error: "Your user record is missing; reload and try again.",
          } as ServerMessage),
        );
        return true;
      }
      const result = await mintInvite({
        username: user.name,
        role: user.role,
        createdBy: user.name,
        allowExisting: true,
        replacePriorForUsername: true,
      });
      if (!result.ok) {
        ws.send(
          JSON.stringify({
            type: "invite_minted",
            requestId: cmd.requestId,
            ok: false,
            error: result.error,
          } as ServerMessage),
        );
        return true;
      }
      const { origin } = buildPublicOrigin();
      ws.send(
        JSON.stringify({
          type: "invite_minted",
          requestId: cmd.requestId,
          ok: true,
          url: `${origin}/i/${result.rawToken}`,
          invite: {
            tokenPrefix: result.invite.tokenPrefix,
            username: result.invite.username,
            role: result.invite.role,
            createdBy: result.invite.createdBy,
            createdAt: result.invite.createdAt,
            expiresAt: result.invite.expiresAt,
          },
        } as ServerMessage),
      );
      pushInvitesListToEachWs();
      return true;
    }
    case "revoke_invite": {
      const user = getWsUser(ws);
      if (!user) return true;
      let result: "ok" | "not_found" | "ambiguous";
      if (user.role === "owner") {
        result = await revokeInviteByPrefix(cmd.tokenPrefix);
      } else {
        result = await revokeOutstandingInviteByPrefixForUsername(cmd.tokenPrefix, user.name);
      }
      if (result === "ok") {
        broadcastToOwners({ type: "invite_revoked", tokenPrefix: cmd.tokenPrefix });
        pushInvitesListToEachWs();
      } else if (result === "ambiguous") {
        console.warn(`[auth] ambiguous invite prefix ${cmd.tokenPrefix} — refused revoke`);
      }
      return true;
    }
    case "get_access_settings": {
      return handleAccessSettingsCommand(cmd, ws, pushInvitesListToEachWs);
    }
    case "update_access_settings": {
      return handleAccessSettingsCommand(cmd, ws, pushInvitesListToEachWs);
    }
    default:
      return false;
  }
}
