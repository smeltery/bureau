import type { ServerWebSocket } from "bun";
import type { ClientCommand, ServerMessage, TaskItem } from "../../shared/types.ts";
import { generateTaskId, isValidPriority, isValidStatus } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import * as CronjobManager from "../cronjobs/index.ts";
import { loadOfficeConfig, saveOfficeConfig, saveRecentCwd, saveTasks } from "../persistence.ts";
import { broadcast, browsers, setTasks, tasks } from "./broadcast.ts";
import { stopWatch, watchFile } from "../file-editor.ts";
import { editorWatchers } from "../index.ts";
import { pushPresenceListToEachWs, sendInitialPayload } from "../index.ts";
import { canSeeRoom, claimUser, deleteUser, getSessionContext, getUserById, getWsUser, updateUser, wouldDeleteLeaveNoOwner } from "../users.ts";
import { refreshPresenceForUser, setPresence } from "../presence.ts";
import {
  buildPublicOrigin,
  evictSessionsForUserId,
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
import { normalizePublicOrigin } from "../../shared/public-origin.ts";

function editorKey(agentId: string, absPath: string): string {
  return `${agentId}\0${absPath}`;
}

function getWatcherMap(ws: ServerWebSocket<unknown>) {
  let map = editorWatchers.get(ws);
  if (!map) {
    map = new Map();
    editorWatchers.set(ws, map);
  }
  return map;
}

function canUseAgent(ws: ServerWebSocket<unknown>, agentId: string): boolean {
  const agent = AgentManager.getAllAgents().find((a) => a.id === agentId);
  if (!agent) return false;
  const roomId = AgentManager.getRooms()[agent.room]?.id;
  return !!roomId && canSeeRoom(getWsUser(ws), roomId);
}

function canUseRoom(ws: ServerWebSocket<unknown>, roomId: string): boolean {
  return canSeeRoom(getWsUser(ws), roomId);
}

function isOwner(ws: ServerWebSocket<unknown>): boolean {
  return getWsUser(ws)?.role === "owner";
}

// Push an invites list to every WS using the right scope for the receiving
// session: owners get the full list; members get just the invites bound to
// their own username (driving the member self-devices view). Used after any
// mutation that could change either scope.
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

// Companion to pushInvitesListToEachWs for active sessions. Owners see the
// global list; members see only their own user's sessions (rename-stable
// via stable userId).
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

// Fan-out for owner-scoped events that carry per-prefix details (e.g. an
// invite or session was revoked). Members don't render the owner Access
// pane, but a plain broadcast() would still seed those rows into their
// reducer state — leaking other users' token prefixes / usernames /
// timestamps. Routing only the owner-WS subset preserves the owner-only
// design contract.
function broadcastToOwners(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const ws of browsers) {
    if (isOwner(ws)) ws.send(data);
  }
}

export async function handleCommand(cmd: ClientCommand, ws: ServerWebSocket<unknown>) {
  switch (cmd.type) {
    case "ping":
      ws.send(JSON.stringify({ type: "pong" } as ServerMessage));
      break;
    case "claim_user": {
      claimUser(ws, cmd.username, AgentManager.getRooms());
      sendInitialPayload(ws);
      pushPresenceListToEachWs();
      break;
    }
    case "update_user": {
      const updated = updateUser(getWsUser(ws), cmd.userId, cmd.changes, AgentManager.getRooms());
      for (const browser of browsers) {
        sendInitialPayload(browser);
      }
      if (updated) {
        refreshPresenceForUser(updated.id, { name: updated.name, avatarColor: updated.avatarColor, avatarVariant: updated.avatarVariant }, new Set(updated.allowedRooms));
        pushPresenceListToEachWs();
      }
      break;
    }
    case "delete_user": {
      const actor = getWsUser(ws);
      if (!actor || actor.role !== "owner") break;
      // Lockout-prevention: refuse deletion that would leave the office
      // without any owner record on disk. Defense in depth: same invariant
      // as the session-revoke check, applied to user records.
      if (wouldDeleteLeaveNoOwner(cmd.userId)) {
        console.warn(`[auth] delete_user "${cmd.userId}" refused: would leave office with no owners`);
        break;
      }
      deleteUser(actor, cmd.userId);
      for (const browser of browsers) {
        sendInitialPayload(browser);
      }
      // Evict any sessions the deleted user still had open: their browsers
      // get session_expired + close so they land on the login wall instead
      // of looping reconnect against a now-orphaned cookie.
      await evictSessionsForUserId(cmd.userId);
      break;
    }
    case "list_active_sessions": {
      const user = getWsUser(ws);
      if (!user) {
        ws.send(JSON.stringify({ type: "sessions_active_list", sessions: [] } as ServerMessage));
        break;
      }
      if (user.role === "owner") {
        ws.send(JSON.stringify({ type: "sessions_active_list", sessions: listAuthSessions() } as ServerMessage));
      } else {
        ws.send(JSON.stringify({ type: "sessions_active_list", sessions: listActiveSessionsForUserId(user.id) } as ServerMessage));
      }
      break;
    }
    case "revoke_session": {
      // Branch on role BEFORE any prefix-based check. The owner path runs
      // its lockout precheck against the global session set (owners can
      // revoke anyone's session, so they're allowed to know that a given
      // prefix is the last owner session). The member path must not run
      // that precheck on the unscoped set, because a divergent "blocked"
      // reason for a foreign prefix would leak the existence of an owner
      // session at that prefix. The scoped mutator folds the lockout check
      // inside its own scope-confirmed branch.
      const user = getWsUser(ws);
      if (!user) break;
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
          break;
        }
        const result = await revokeSessionByPrefix(cmd.sessionPrefix);
        if (result === "ok") {
          broadcastToOwners({ type: "session_revoked", sessionPrefix: cmd.sessionPrefix });
          pushSessionsListToEachWs();
        } else if (result === "ambiguous") {
          console.warn(`[auth] ambiguous session prefix ${cmd.sessionPrefix} — refused revoke`);
        }
        break;
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
      break;
    }
    case "logout": {
      // Treat the WS-side logout as a synchronization signal — the actual
      // cookie clear happens via POST /auth/logout. Surface the same
      // lockout-prevention check here so the UI can refuse the "Sign out"
      // button before the form submit fires.
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
        break;
      }
      if (sessionHash) await logoutBySessionHash(sessionHash);
      ws.send(JSON.stringify({ type: "session_context", context: null } as ServerMessage));
      break;
    }
    case "list_invites": {
      const user = getWsUser(ws);
      if (!user) break;
      if (user.role === "owner") {
        ws.send(JSON.stringify({ type: "invites_list", invites: listInvites() } as ServerMessage));
      } else {
        ws.send(JSON.stringify({ type: "invites_list", invites: listInvitesForUsername(user.name) } as ServerMessage));
      }
      break;
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
        break;
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
        break;
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
      break;
    }
    case "mint_self_invite": {
      // Tailscale-style "additional device" flow. Bound to the caller's own
      // user record, mirrors their role (members mint member invites,
      // owners mint owner invites), and uses the tighter 1h self-invite
      // TTL. replacePriorForUsername enforces the 1-outstanding-per-user
      // rule atomically AND is the marker mintInvite uses to pick the
      // shorter TTL.
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
        break;
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
        break;
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
      break;
    }
    case "revoke_invite": {
      // Owners use the unrestricted revoker; members route through the
      // scoped mutator so authorization and the state change happen in a
      // single mutate() — no TOCTOU window. A unique prefix that isn't
      // theirs returns "not_found" silently so we don't reveal the foreign
      // row's existence.
      const user = getWsUser(ws);
      if (!user) break;
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
      break;
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
        break;
      }
      const cfg = loadOfficeConfig();
      const envRaw = process.env.BUREAU_PUBLIC_ORIGIN?.trim() ?? "";
      const envOriginSet = envRaw.length > 0;
      const envOrigin = envRaw ? normalizePublicOrigin(envRaw) : null;
      // Match the boot-time migration default so the UI reflects the same
      // effective state the running process is using. Only a *valid* env
      // value implies external access; an invalid env value is ignored.
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
      break;
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
        break;
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
          break;
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
        break;
      }
      // Refuse the save when *enabling* external access against a valid
      // BUREAU_PUBLIC_ORIGIN env override that differs from the typed URL.
      // After restart the env var would win, so the freshly minted signInUrl
      // we'd otherwise return points at an origin the running server would
      // 403 on. Only the *enable* path is gated: disable is safe because
      // the boot freeze pins loopback regardless of env.
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
        break;
      }
      // Normalize officeName: trim + length-cap; "" / missing field clears it.
      const rawOfficeName = typeof cmd.officeName === "string" ? cmd.officeName.trim().slice(0, 64) : "";
      // undefined means "leave it alone" (older client, partial update); null
      // / "" means "explicitly clear".
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
        break;
      }
      // Mint a fresh owner self-invite bound to the calling user, using the
      // NEW public origin (not buildPublicOrigin(), which is boot-frozen).
      // Skip the mint when external access is being turned OFF.
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
      // Office-name changes are live (used for the next auth-page render); no
      // restart needed for that piece. externalAccess / publicOrigin still
      // require the systemd restart, which the UI's restartRequired flag
      // surfaces.
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
      break;
    }
    case "presence_update": {
      const user = getWsUser(ws);
      if (!user) break;
      const rooms = AgentManager.getRooms();
      const visibleRooms = user.role === "owner" ? rooms : rooms.filter((r) => user.allowedRooms.includes(r.id));
      const roomId = cmd.currentRoom !== null && Number.isInteger(cmd.currentRoom) ? (visibleRooms[cmd.currentRoom]?.id ?? null) : null;
      let focusedAgentId: string | null = null;
      if (roomId && cmd.focusedAgentId) {
        const agent = AgentManager.getAllAgents().find((a) => a.id === cmd.focusedAgentId);
        if (agent && rooms[agent.room]?.id === roomId) focusedAgentId = agent.id;
      }
      const connectionId = getSessionContext(ws)?.connectionId ?? "";
      const changed = setPresence({
        connectionId,
        userId: user.id,
        username: user.name,
        device: cmd.device ?? null,
        avatarColor: user.avatarColor,
        avatarVariant: user.avatarVariant,
        currentRoomId: roomId,
        focusedAgentId,
        viewMode: cmd.viewMode === "log" || cmd.viewMode === "away" ? cmd.viewMode : "office",
        lastSeenAt: Date.now(),
      });
      if (changed) pushPresenceListToEachWs();
      break;
    }
    case "spawn": {
      if (cmd.roomId && !canUseRoom(ws, cmd.roomId)) break;
      try {
        AgentManager.validateCwd(cmd.cwd);
      } catch (err: any) {
        if (cmd.requestId) {
          ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: err.message || "Invalid directory" } as ServerMessage));
        }
        break;
      }
      saveRecentCwd(cmd.cwd);
      await AgentManager.spawn(
        cmd.name,
        cmd.cwd,
        cmd.permissionMode,
        cmd.desk,
        cmd.customInstructions,
        cmd.roomId,
        cmd.outfit,
        cmd.modelFamily,
        cmd.agentType ?? "claude",
        cmd.codexSandbox,
        cmd.effort,
      );
      if (cmd.requestId) {
        ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      }
      break;
    }
    case "kill":
      if (!canUseAgent(ws, cmd.agentId)) break;
      await AgentManager.kill(cmd.agentId);
      break;
    case "abort":
      if (!canUseAgent(ws, cmd.agentId)) break;
      await AgentManager.abort(cmd.agentId);
      break;
    case "send_message":
      if (!canUseAgent(ws, cmd.agentId)) break;
      // Don't await — let it stream in the background
      AgentManager.sendMessage(cmd.agentId, cmd.text, cmd.username, cmd.attachments);
      break;
    case "dequeue_message":
      if (!canUseAgent(ws, cmd.agentId)) break;
      AgentManager.dequeueMessage(cmd.agentId, cmd.queuedId);
      break;
    case "new_conversation":
      if (!canUseAgent(ws, cmd.agentId)) break;
      await AgentManager.newConversation(cmd.agentId);
      break;
    case "resume":
      if (!canUseAgent(ws, cmd.agentId)) break;
      await AgentManager.resume(cmd.agentId, cmd.sessionId);
      break;
    case "edit_agent": {
      if (!canUseAgent(ws, cmd.agentId)) break;
      if (cmd.cwd) {
        try {
          AgentManager.validateCwd(cmd.cwd);
        } catch (err: any) {
          if (cmd.requestId) {
            ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: err.message || "Invalid directory" } as ServerMessage));
          }
          break;
        }
        saveRecentCwd(cmd.cwd);
      }
      AgentManager.editAgent(cmd.agentId, {
        name: cmd.name,
        cwd: cmd.cwd,
        outfit: cmd.outfit,
        customInstructions: cmd.customInstructions,
        modelFamily: cmd.modelFamily,
        permissionMode: cmd.permissionMode,
        codexSandbox: cmd.codexSandbox,
        effort: cmd.effort,
      });
      if (cmd.requestId) {
        ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      }
      break;
    }
    case "swap_desks":
      if (!canUseRoom(ws, cmd.roomId)) break;
      AgentManager.swapDesks(cmd.deskA, cmd.deskB, cmd.roomId);
      break;
    case "set_topic":
      if (!canUseAgent(ws, cmd.agentId)) break;
      AgentManager.setTopic(cmd.agentId, cmd.topic);
      break;
    case "reset_topic":
      if (!canUseAgent(ws, cmd.agentId)) break;
      AgentManager.resetTopic(cmd.agentId);
      break;
    case "list_sessions": {
      if (!canUseAgent(ws, cmd.agentId)) break;
      const sessions = AgentManager.listSessions(cmd.agentId);
      const currentSessionId = AgentManager.getCurrentSessionId(cmd.agentId);
      broadcast({
        type: "sessions_list",
        agentId: cmd.agentId,
        sessions,
        currentSessionId,
      } as ServerMessage);
      break;
    }
    case "terminal_open": {
      if (!canUseAgent(ws, cmd.agentId)) break;
      const opened = AgentManager.openTerminal(cmd.agentId);
      if (opened) {
        // Replay buffered output so the browser catches up
        const buffer = AgentManager.getTerminalBuffer(cmd.agentId);
        if (buffer) {
          broadcast({ type: "terminal_output", agentId: cmd.agentId, data: buffer } as ServerMessage);
        }
      }
      break;
    }
    case "terminal_input":
      if (!canUseAgent(ws, cmd.agentId)) break;
      AgentManager.terminalInput(cmd.agentId, cmd.data);
      break;
    case "terminal_resize":
      if (!canUseAgent(ws, cmd.agentId)) break;
      AgentManager.terminalResize(cmd.agentId, cmd.cols, cmd.rows);
      break;
    case "terminal_close":
      if (!canUseAgent(ws, cmd.agentId)) break;
      AgentManager.closeTerminal(cmd.agentId);
      break;
    case "editor_open": {
      if (!canUseAgent(ws, cmd.agentId)) break;
      const probe = AgentManager.openEditorFile(cmd.agentId, cmd.path);
      if (!probe.ok) {
        ws.send(
          JSON.stringify({
            type: "editor_open_error",
            agentId: cmd.agentId,
            path: cmd.path,
            reason: probe.error === "not_agent" ? "io_error" : "bad_path",
            message: probe.error === "not_agent" ? "agent not found" : undefined,
          } as ServerMessage),
        );
        break;
      }
      const r = probe.result;
      if (r.kind !== "ok") {
        ws.send(
          JSON.stringify({
            type: "editor_open_error",
            agentId: cmd.agentId,
            path: r.path,
            reason: r.kind,
            message: r.kind === "io_error" ? r.message : undefined,
            size: r.kind === "too_large" ? r.size : undefined,
          } as ServerMessage),
        );
        break;
      }
      ws.send(
        JSON.stringify({
          type: "editor_content",
          agentId: cmd.agentId,
          path: r.path,
          content: r.content,
          mtime: r.mtime,
          language: r.language,
          size: r.size,
        } as ServerMessage),
      );
      // Install (or replace) the per-WS watcher so external edits surface as
      // `editor_external_change`. Replacing collapses duplicate opens.
      const map = getWatcherMap(ws);
      const key = editorKey(cmd.agentId, r.path);
      const old = map.get(key);
      if (old) stopWatch(old);
      const watcher = watchFile(r.path, cmd.agentId, (mtime) => {
        ws.send(JSON.stringify({ type: "editor_external_change", agentId: cmd.agentId, path: r.path, mtime } as ServerMessage));
      });
      if (watcher) map.set(key, watcher);
      break;
    }
    case "editor_save": {
      if (!canUseAgent(ws, cmd.agentId)) break;
      const abs = AgentManager.resolveEditorPathForAgent(cmd.agentId, cmd.path);
      if (!abs) {
        ws.send(JSON.stringify({ type: "editor_save_response", agentId: cmd.agentId, path: cmd.path, ok: false, error: "agent not found" } as ServerMessage));
        break;
      }
      const result = AgentManager.saveEditorFile(abs, cmd.content, cmd.expectedMtime, cmd.force ?? false);
      if (result.kind === "ok") {
        ws.send(JSON.stringify({ type: "editor_save_response", agentId: cmd.agentId, path: result.path, ok: true, mtime: result.mtime } as ServerMessage));
      } else if (result.kind === "stale") {
        ws.send(
          JSON.stringify({
            type: "editor_save_response",
            agentId: cmd.agentId,
            path: result.path,
            ok: false,
            reason: "stale",
            currentMtime: result.currentMtime,
            error: "File changed on disk since you opened it.",
          } as ServerMessage),
        );
      } else {
        ws.send(JSON.stringify({ type: "editor_save_response", agentId: cmd.agentId, path: result.path, ok: false, error: result.message } as ServerMessage));
      }
      break;
    }
    case "editor_close": {
      if (!canUseAgent(ws, cmd.agentId)) break;
      const abs = AgentManager.resolveEditorPathForAgent(cmd.agentId, cmd.path);
      if (!abs) break;
      const map = getWatcherMap(ws);
      const key = editorKey(cmd.agentId, abs);
      const w = map.get(key);
      if (w) {
        stopWatch(w);
        map.delete(key);
      }
      break;
    }
    case "update_office_settings": {
      const envFile = cmd.envFile && cmd.envFile.trim() ? cmd.envFile.trim() : null;
      if (envFile) {
        try {
          AgentManager.validateEnvPath(envFile);
        } catch (err: any) {
          ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: false, error: err.message || "Invalid env file" } as ServerMessage));
          break;
        }
      }
      AgentManager.setOfficeSettings(cmd.prompt, envFile);
      ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      break;
    }
    case "update_room_settings": {
      if (!canUseRoom(ws, cmd.roomId)) break;
      const envFile = cmd.envFile && cmd.envFile.trim() ? cmd.envFile.trim() : null;
      if (envFile) {
        try {
          AgentManager.validateEnvPath(envFile);
        } catch (err: any) {
          ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: false, error: err.message || "Invalid env file" } as ServerMessage));
          break;
        }
      }
      const ok = AgentManager.setRoomSettings(cmd.roomId, cmd.prompt, envFile);
      if (!ok) {
        ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: false, error: "Room not found" } as ServerMessage));
      } else {
        ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      }
      break;
    }
    case "request_cwd_validation": {
      try {
        AgentManager.validateCwd(cmd.cwd);
        ws.send(JSON.stringify({ type: "cwd_validation", requestId: cmd.requestId, ok: true } as ServerMessage));
      } catch (err: any) {
        ws.send(JSON.stringify({ type: "cwd_validation", requestId: cmd.requestId, ok: false, error: err.message || "Invalid directory" } as ServerMessage));
      }
      break;
    }
    case "request_settings_validation": {
      let envFile: string | null = null;
      if (cmd.scope === "office") {
        envFile = AgentManager.getOfficeSettings().envFile;
      } else if (cmd.scope === "room" && cmd.roomId) {
        const room = AgentManager.getRooms().find((r) => r.id === cmd.roomId);
        envFile = room?.envFile ?? null;
      }
      if (!envFile) {
        ws.send(JSON.stringify({ type: "settings_validation", requestId: cmd.requestId, scope: cmd.scope, roomId: cmd.roomId, envFile: null, ok: true } as ServerMessage));
        break;
      }
      try {
        const keyCount = AgentManager.validateEnvPath(envFile);
        ws.send(JSON.stringify({ type: "settings_validation", requestId: cmd.requestId, scope: cmd.scope, roomId: cmd.roomId, envFile, ok: true, keyCount } as ServerMessage));
      } catch (err: any) {
        ws.send(
          JSON.stringify({
            type: "settings_validation",
            requestId: cmd.requestId,
            scope: cmd.scope,
            roomId: cmd.roomId,
            envFile,
            ok: false,
            error: err.message || "Invalid env file",
          } as ServerMessage),
        );
      }
      break;
    }
    case "add_task": {
      const task: TaskItem = {
        id: generateTaskId(tasks.map((t) => t.id)),
        title: cmd.title.trim(),
        description: cmd.description,
        priority: cmd.priority && isValidPriority(cmd.priority) ? cmd.priority : undefined,
        status: "open",
        assignee: cmd.assignee,
        createdBy: cmd.username,
        createdAt: Date.now(),
      };
      tasks.push(task);
      saveTasks(tasks);
      broadcast({ type: "tasks", tasks } as ServerMessage);
      break;
    }
    case "update_task": {
      const task = tasks.find((t) => t.id === cmd.id);
      if (task) {
        const c = cmd.changes;
        if (c.title !== undefined) task.title = String(c.title);
        if (c.description !== undefined) task.description = c.description ? String(c.description) : undefined;
        if (c.assignee !== undefined) task.assignee = c.assignee ? String(c.assignee) : undefined;
        if (c.status !== undefined && isValidStatus(c.status)) task.status = c.status;
        if (c.priority !== undefined && isValidPriority(c.priority)) task.priority = c.priority;
        saveTasks(tasks);
        broadcast({ type: "tasks", tasks } as ServerMessage);
      }
      break;
    }
    case "delete_task": {
      const next = tasks.filter((t) => t.id !== cmd.id);
      setTasks(next);
      saveTasks(next);
      broadcast({ type: "tasks", tasks: next } as ServerMessage);
      break;
    }
    case "create_room":
      if (!isOwner(ws)) break;
      AgentManager.createRoom(cmd.name);
      pushPresenceListToEachWs();
      break;
    case "close_room":
      if (!canUseRoom(ws, cmd.roomId)) break;
      AgentManager.closeRoom(cmd.roomId);
      pushPresenceListToEachWs();
      break;
    case "rename_room":
      if (!canUseRoom(ws, cmd.roomId)) break;
      AgentManager.renameRoom(cmd.roomId, cmd.name);
      break;
    case "move_agent":
      if (!canUseAgent(ws, cmd.agentId) || !canUseRoom(ws, cmd.targetRoomId)) break;
      AgentManager.moveAgent(cmd.agentId, cmd.targetRoomId);
      break;
    case "reorder_rooms":
      if (!isOwner(ws)) break;
      AgentManager.reorderRooms(cmd.order);
      pushPresenceListToEachWs();
      break;
    case "edit_message":
      if (!canUseAgent(ws, cmd.agentId)) break;
      // Don't await — let it stream in the background (like send_message)
      AgentManager.editMessage(cmd.agentId, cmd.logEntryId, cmd.newText, cmd.username);
      break;
    case "add_cronjob": {
      try {
        AgentManager.validateCwd(cmd.cwd);
      } catch (err: any) {
        if (cmd.requestId) {
          ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: err.message || "Invalid directory" } as ServerMessage));
        }
        break;
      }
      saveRecentCwd(cmd.cwd);
      CronjobManager.addCronjob({
        name: cmd.name,
        schedule: cmd.schedule,
        prompt: cmd.prompt,
        cwd: cmd.cwd,
        modelFamily: cmd.modelFamily,
        permissionMode: cmd.permissionMode,
        username: cmd.username,
        device: cmd.device,
      });
      if (cmd.requestId) {
        ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      }
      break;
    }
    case "update_cronjob": {
      if (cmd.changes.cwd) {
        try {
          AgentManager.validateCwd(cmd.changes.cwd);
        } catch (err: any) {
          if (cmd.requestId) {
            ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: err.message || "Invalid directory" } as ServerMessage));
          }
          break;
        }
        saveRecentCwd(cmd.changes.cwd);
      }
      CronjobManager.updateCronjob(cmd.id, cmd.changes);
      if (cmd.requestId) {
        ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      }
      break;
    }
    case "delete_cronjob":
      CronjobManager.deleteCronjob(cmd.id);
      break;
    case "run_cronjob_now":
      CronjobManager.runCronjobNow(cmd.id, cmd.username, cmd.device);
      break;
    case "update_cronjobs_prompt":
      CronjobManager.setCronjobsPrompt(cmd.value);
      ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      break;
    case "list_cronjob_runs": {
      const runs = CronjobManager.getRunsForCronjob(cmd.cronjobId);
      ws.send(JSON.stringify({ type: "cronjob_runs", cronjobId: cmd.cronjobId, runs } as ServerMessage));
      break;
    }
    case "list_all_cronjob_runs": {
      // Returns runs for every cronjob dir on disk (including deleted ones)
      // so the Runs tab can surface historical runs after a cronjob is gone.
      for (const { jobId, runs } of CronjobManager.getAllRunsByJob()) {
        ws.send(JSON.stringify({ type: "cronjob_runs", cronjobId: jobId, runs } as ServerMessage));
      }
      // Sentinel so the client can flip its "runs loaded" flag even when no
      // cronjob has ever fired (no run dirs on disk = zero cronjob_runs sent).
      ws.send(JSON.stringify({ type: "cronjob_runs_complete" } as ServerMessage));
      break;
    }
    case "load_cronjob_run": {
      // Client passes jobId from the run row it just clicked, so no scan
      // needed. Works for runs from deleted cronjobs too: getRunTranscript
      // reads from disk regardless of whether the cronjob config still exists.
      const { entries } = CronjobManager.getRunTranscript(cmd.cronjobId, cmd.runId);
      for (const entry of entries) {
        ws.send(JSON.stringify({ type: "log_entry", entry } as ServerMessage));
      }
      break;
    }
    case "send_cronjob_run_message":
      // Don't await — let it stream in the background (matches send_message).
      CronjobManager.sendRunMessage(cmd.cronjobId, cmd.runId, cmd.text, cmd.username);
      break;
    case "edit_cronjob_run_message":
      // Don't await — let it stream in the background (matches edit_message).
      CronjobManager.editRunMessage(cmd.cronjobId, cmd.runId, cmd.logEntryId, cmd.newText, cmd.username);
      break;
  }
}
