import type { ServerWebSocket } from "bun";
import type { ClientCommand, ServerMessage } from "../../shared/types.ts";
import { normalizePublicOrigin } from "../../shared/public-origin.ts";
import { loadOfficeConfig, saveOfficeConfig } from "../persistence.ts";
import { browsers } from "./broadcast.ts";
import { getSessionContext, getUserById, getWsUser } from "../users.ts";
import {
  buildPublicOrigin,
  isProcessBoundLoopback,
  listActiveSessions as listAuthSessions,
  listActiveSessionsForUserId,
  listInvites,
  listInvitesForUsername,
  logoutBySessionHash,
  mintInvite,
  resolveSessionHashByPrefix,
  revokeActiveSessionByPrefixForUserId,
  revokeInviteByPrefix,
  revokeOutstandingInviteByPrefixForUsername,
  revokeSessionByPrefix,
  setOfficeName,
  wouldRevokeLeaveOfficeUnreachable,
} from "../auth/auth.ts";

function isOwner(ws: ServerWebSocket<unknown>): boolean {
  return getWsUser(ws)?.role === "owner";
}

function pushInvitesListToEachWs() {
  for (const browser of browsers) {
    const user = getWsUser(browser);
    if (!user) continue;
    if (user.role === "owner") {
      browser.send(JSON.stringify({ type: "invites_list", invites: listInvites() } as ServerMessage));
    } else {
      browser.send(JSON.stringify({ type: "invites_list", invites: listInvitesForUsername(user.name) } as ServerMessage));
    }
  }
}

function pushSessionsListToEachWs() {
  for (const browser of browsers) {
    const user = getWsUser(browser);
    if (!user) continue;
    if (user.role === "owner") {
      browser.send(JSON.stringify({ type: "sessions_active_list", sessions: listAuthSessions() } as ServerMessage));
    } else {
      browser.send(JSON.stringify({ type: "sessions_active_list", sessions: listActiveSessionsForUserId(user.id) } as ServerMessage));
    }
  }
}

function broadcastToOwners(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const ws of browsers) {
    if (isOwner(ws)) ws.send(data);
  }
}

export async function handleAccessCommand(cmd: ClientCommand, ws: ServerWebSocket<unknown>): Promise<boolean> {
  switch (cmd.type) {
    case "list_active_sessions": {
      const user = getWsUser(ws);
      if (!user) {
        ws.send(JSON.stringify({ type: "sessions_active_list", sessions: [] } as ServerMessage));
        return true;
      }
      if (user.role === "owner") {
        ws.send(JSON.stringify({ type: "sessions_active_list", sessions: listAuthSessions() } as ServerMessage));
      } else {
        ws.send(JSON.stringify({ type: "sessions_active_list", sessions: listActiveSessionsForUserId(user.id) } as ServerMessage));
      }
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
      if (user.role === "owner") {
        ws.send(JSON.stringify({ type: "invites_list", invites: listInvites() } as ServerMessage));
      } else {
        ws.send(JSON.stringify({ type: "invites_list", invites: listInvitesForUsername(user.name) } as ServerMessage));
      }
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
      const user = getWsUser(ws);
      if (!user || user.role !== "owner") {
        ws.send(
          JSON.stringify({
            type: "access_settings",
            ok: false,
            error: "Only owners can view access settings.",
          } as ServerMessage),
        );
        return true;
      }
      const cfg = loadOfficeConfig();
      const envRaw = process.env.BUREAU_PUBLIC_ORIGIN?.trim() ?? "";
      const envOriginSet = envRaw.length > 0;
      const envOrigin = envRaw ? normalizePublicOrigin(envRaw) : null;
      const effectiveExternal = cfg.externalAccess !== null ? cfg.externalAccess : cfg.publicOrigin !== null || envOrigin !== null;
      ws.send(
        JSON.stringify({
          type: "access_settings",
          ok: true,
          externalAccess: effectiveExternal,
          publicOrigin: cfg.publicOrigin,
          envOriginSet,
          envOrigin,
          boundLoopback: isProcessBoundLoopback(),
          officeName: cfg.officeName,
        } as ServerMessage),
      );
      return true;
    }
    case "update_access_settings": {
      const user = getWsUser(ws);
      if (!user || user.role !== "owner") {
        ws.send(
          JSON.stringify({
            type: "access_settings_updated",
            requestId: cmd.requestId,
            ok: false,
            error: "Only owners can change access settings.",
          } as ServerMessage),
        );
        return true;
      }
      const wantsExternal = !!cmd.externalAccess;
      const rawOrigin = typeof cmd.publicOrigin === "string" ? cmd.publicOrigin.trim() : "";
      let publicOrigin: string | null = null;
      if (rawOrigin) {
        const normalized = normalizePublicOrigin(rawOrigin);
        if (!normalized) {
          ws.send(
            JSON.stringify({
              type: "access_settings_updated",
              requestId: cmd.requestId,
              ok: false,
              error: "Public URL must be https://<host> or http://localhost (no path, query, or fragment).",
            } as ServerMessage),
          );
          return true;
        }
        publicOrigin = normalized;
      }
      if (wantsExternal && !publicOrigin) {
        ws.send(
          JSON.stringify({
            type: "access_settings_updated",
            requestId: cmd.requestId,
            ok: false,
            error: "Enabling external access requires a public URL.",
          } as ServerMessage),
        );
        return true;
      }
      const envRaw = process.env.BUREAU_PUBLIC_ORIGIN?.trim() ?? "";
      const envOrigin = envRaw ? normalizePublicOrigin(envRaw) : null;
      if (wantsExternal && envOrigin && publicOrigin && envOrigin !== publicOrigin) {
        ws.send(
          JSON.stringify({
            type: "access_settings_updated",
            requestId: cmd.requestId,
            ok: false,
            error: `BUREAU_PUBLIC_ORIGIN is still set to ${envOrigin}. Remove it from the service environment or set the Public URL to the same value, then save again.`,
            envOrigin,
          } as ServerMessage),
        );
        return true;
      }
      const rawOfficeName = typeof cmd.officeName === "string" ? cmd.officeName.trim().slice(0, 64) : "";
      const nextOfficeName: string | null = cmd.officeName === undefined ? (loadOfficeConfig().officeName ?? null) : rawOfficeName || null;
      const prevCfg = loadOfficeConfig();
      try {
        saveOfficeConfig({
          prompt: prevCfg.prompt,
          envFile: prevCfg.envFile,
          publicOrigin,
          externalAccess: wantsExternal,
          officeName: nextOfficeName,
        });
      } catch (err) {
        ws.send(
          JSON.stringify({
            type: "access_settings_updated",
            requestId: cmd.requestId,
            ok: false,
            error: (err as Error).message,
          } as ServerMessage),
        );
        return true;
      }
      let signInUrl: string | null = null;
      if (wantsExternal && publicOrigin) {
        const me = getUserById(user.id);
        if (me) {
          const minted = await mintInvite({
            username: me.name,
            role: me.role,
            createdBy: user.name,
            allowExisting: true,
            replacePriorForUsername: true,
          });
          if (minted.ok) {
            signInUrl = `${publicOrigin}/i/${minted.rawToken}`;
            pushInvitesListToEachWs();
          } else {
            console.warn(`[auth] update_access_settings: self-invite mint failed: ${minted.error}`);
          }
        }
      }
      setOfficeName(nextOfficeName);
      ws.send(
        JSON.stringify({
          type: "access_settings_updated",
          requestId: cmd.requestId,
          ok: true,
          externalAccess: wantsExternal,
          publicOrigin,
          signInUrl,
          restartRequired: true,
          envOrigin,
          officeName: nextOfficeName,
        } as ServerMessage),
      );
      return true;
    }
    default:
      return false;
  }
}
