import type { ClientCommand, ServerMessage } from "../shared/types.ts";
import type { InviteWire } from "../shared/types.ts";
import * as AgentManager from "./agent-manager.ts";
import * as CronjobManager from "./cronjobs/index.ts";
import { loadEnabledPlugins, loadOfficeConfig, saveOfficeConfig } from "./persistence.ts";
import { loadPlugins } from "./plugins/registry.ts";
import { join as joinPath } from "path";
import { onUpdateChange, startUpdateChecker } from "./update-checker.ts";
import { getBackupStatus, startBackupScheduler } from "./backup.ts";
import { broadcast, browsers } from "./ws/broadcast.ts";
import { handleCommand } from "./ws/commands.ts";
import { claimUser, clearWsUser, deleteUserById, getSessionContext, getUserById, getUserByName, getWsUser, setWsSessionPrefix, updateUser, wouldDeleteLeaveNoOwner } from "./users.ts";
import { refreshPresenceForUser, removePresence } from "./presence.ts";
import { closeEditorWatch, closeEditorWatchesFor, findBrowserConnection, watchEditorFile } from "./editor-watchers.ts";
export { editorWatchers } from "./editor-watchers.ts";
import { pushPresenceListToEachWs, sendInitialPayload } from "./ws-initial-payload.ts";
export { pushPresenceListToEachWs, sendInitialPayload } from "./ws-initial-payload.ts";
import { wireAgentAndCronjobEvents } from "./ws/agent-events.ts";
import { handleLiveReloadRequest, startLiveReloadWatcher } from "./http/live-reload.ts";
import { handleTasksRequest } from "./http/tasks.ts";
import { handleCronjobsRequest } from "./http/cronjobs.ts";
import { handlePluginsRequest } from "./http/plugins.ts";
import { handleFilesRequest } from "./http/files.ts";
import { handleAgentsRequest } from "./http/agents.ts";
import { handleEditorRequest } from "./http/editor.ts";
import { handleRoomsRequest } from "./http/rooms.ts";
import { handleOfficeSettingsRequest } from "./http/office-settings.ts";
import { handleValidateRequest } from "./http/validate.ts";
import { handleBackendsRequest } from "./http/backends.ts";
import { handleMemoryRequest } from "./http/memory.ts";
import { handleViewRequest, type ViewChangeInput } from "./http/view.ts";
import { handleSystemRequest } from "./http/system.ts";
import { handleSessionsRequest, type SessionRevokeResult } from "./http/sessions.ts";
import { handleInvitesRequest, type InviteMintResult, type InviteRevokeResult } from "./http/invites.ts";
import { handleAccessRequest, type AccessSettingsWire, type SetAccessResult } from "./http/access.ts";
import { handleUsersRequest, type UserDeleteResult, type UserMutationResult, type UserRecordChanges } from "./http/users.ts";
import { handleStaticRequest } from "./http/static.ts";
import { getPublicOrigin, originAllowed, stateChangingOriginAllowed } from "./public-origin.ts";
import { authenticate, setOnOwnerCreated, tryHandleAuthRoute } from "./auth/auth-middleware.ts";
import {
  getOfficeName,
  isProcessPreClaim,
  registerSocket,
  revalidateByHash,
  setOfficeName,
  setOnInviteConsumed,
  setOnSessionsChanged,
  setRoomsSnapshotProvider,
  unregisterSocket,
  buildPublicOrigin,
  evictSessionsForUserId,
  isProcessBoundLoopback,
  listActiveSessions,
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
  type SessionLookup,
  wouldRevokeLeaveOfficeUnreachable,
} from "./auth/auth.ts";
import { startAdminSocket } from "./auth/admin-socket.ts";
import { normalizePublicOrigin } from "../shared/public-origin.ts";
import { boundExternal, initializeAccessConfig } from "./boot-access.ts";
import { printStartupBanner, resolveListenOptions } from "./boot-listen.ts";

// ---------------------------------------------------------------------------
// CLI sub-command fast-path. The operator invokes
//   `bun run server/index.ts owner-login --name X`
// to mint a recovery URL for an existing owner. We dynamic-import the CLI
// module (which has no auth-state side effects of its own) and exit before
// the heavy boot side effects below — listener, schedulers, etc. The CLI
// just opens an HTTP-over-unix-socket request to the running server's admin
// endpoint, so the running server's mutex is the only auth-state touchpoint.
if (Bun.argv[2] === "owner-login") {
  const { runAdminCli } = await import("./auth/admin-cli.ts");
  await runAdminCli(Bun.argv.slice(2));
  process.exit(0);
}

initializeAccessConfig();

// Inject the room snapshot provider auth.ts uses when seeding a new owner's
// allowedRooms at invite-acceptance time. The provider closes over
// AgentManager.getRooms() rather than auth.ts importing agent-manager
// directly — keeps the dependency graph one-way.
setRoomsSnapshotProvider(() => AgentManager.getRooms().map((r) => r.id));

// When an invite is consumed (typically via HTTP POST /auth/accept, which
// never touches the WS dispatch loop), fan out an updated invites list to
// every owner WS so their Access pane re-renders in real time.
setOnInviteConsumed(() => {
  for (const browser of browsers) {
    const user = getWsUser(browser);
    if (user?.role === "owner") {
      browser.send(JSON.stringify({ type: "invites_list", invites: listInvites() } as ServerMessage));
      browser.send(JSON.stringify({ type: "sessions_active_list", sessions: listActiveSessions() } as ServerMessage));
    }
  }
});

// Owner sessions table stays fresh on any server-initiated session
// invalidation: revoke, logout, delete-user fanout, and the hot-path
// expiry / orphan branches.
setOnSessionsChanged(() => {
  for (const browser of browsers) {
    const user = getWsUser(browser);
    if (user?.role === "owner") {
      browser.send(JSON.stringify({ type: "sessions_active_list", sessions: listActiveSessions() } as ServerMessage));
    }
  }
});

// First-claim hook: seed the office at the moment the first owner is
// created (tokenless claim form or legacy bootstrap-invite accept). Bureau
// starts empty (the first agent is spawned by the user on demand), so this
// hook is intentionally a no-op for now. It exists as the supported extension
// point for seeding welcome agents into a freshly claimed office.
setOnOwnerCreated(async ({ username }) => {
  void username;
});

wireAgentAndCronjobEvents();

// Start the live-reload filesystem watcher (no-op unless BUREAU_LIVE_RELOAD=1)
startLiveReloadWatcher();

const { socketPath, port: PORT } = resolveListenOptions();

// Per-WS auth context. Set at upgrade; cleared at close. WsData carries the
// session lookup so per-message rechecks can revoke active connections
// within ~1s of an Access-pane revoke. Loopback connections (agents on the
// same host) skip auth and run with `session === null`.
interface WsData {
  session: SessionLookup | null;
}

function pushSessionsListToEachWs() {
  for (const browser of browsers) {
    const user = getWsUser(browser);
    if (!user) continue;
    const sessions = user.role === "owner" ? listActiveSessions() : listActiveSessionsForUserId(user.id);
    browser.send(JSON.stringify({ type: "sessions_active_list", sessions } as ServerMessage));
  }
}

function pushInvitesListToEachWs() {
  for (const browser of browsers) {
    const user = getWsUser(browser);
    if (!user) continue;
    const invites = user.role === "owner" ? listInvites() : listInvitesForUsername(user.name);
    browser.send(JSON.stringify({ type: "invites_list", invites } as ServerMessage));
  }
}

function broadcastToOwners(msg: ServerMessage) {
  const data = JSON.stringify(msg);
  for (const ws of browsers) {
    if (getWsUser(ws)?.role === "owner") ws.send(data);
  }
}

async function revokeSessionForApi(userId: string, role: "owner" | "member", sessionPrefix: string): Promise<SessionRevokeResult> {
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

async function logoutSessionForApi(sessionIdHash: string): Promise<SessionRevokeResult> {
  if (wouldRevokeLeaveOfficeUnreachable(sessionIdHash)) return "would_strand_office";
  const ok = await logoutBySessionHash(sessionIdHash);
  if (ok) pushSessionsListToEachWs();
  return ok ? "ok" : "not_found";
}

async function mintInviteForApi(input: { username: string; role: "owner" | "member"; allowExisting: boolean; createdBy: string }): Promise<InviteMintResult> {
  const result = await mintInvite(input);
  if (!result.ok) return { ok: false, error: result.error };
  const { origin } = buildPublicOrigin();
  pushInvitesListToEachWs();
  return { ok: true, url: `${origin}/i/${result.rawToken}`, invite: wireInvite(result.invite) };
}

async function mintSelfInviteForApi(input: { username: string; role: "owner" | "member"; createdBy: string }): Promise<InviteMintResult> {
  const result = await mintInvite({
    ...input,
    allowExisting: true,
    replacePriorForUsername: true,
  });
  if (!result.ok) return { ok: false, error: result.error };
  const { origin } = buildPublicOrigin();
  pushInvitesListToEachWs();
  return { ok: true, url: `${origin}/i/${result.rawToken}`, invite: wireInvite(result.invite) };
}

async function revokeInviteForApi(username: string, role: "owner" | "member", tokenPrefix: string): Promise<InviteRevokeResult> {
  const result = role === "owner" ? await revokeInviteByPrefix(tokenPrefix) : await revokeOutstandingInviteByPrefixForUsername(tokenPrefix, username);
  if (result === "ok") {
    broadcastToOwners({ type: "invite_revoked", tokenPrefix } as ServerMessage);
    pushInvitesListToEachWs();
  }
  return result;
}

function wireInvite(invite: {
  tokenPrefix: string;
  username: string | null;
  role: "owner" | "member";
  createdBy: string | null;
  createdAt: number;
  expiresAt: number;
  bootstrap: boolean;
}): InviteWire {
  return {
    tokenPrefix: invite.tokenPrefix,
    username: invite.username,
    role: invite.role,
    createdBy: invite.createdBy,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    ...(invite.bootstrap ? { bootstrap: true as const } : {}),
  };
}

function readAccessSettingsForApi(): AccessSettingsWire {
  const cfg = loadOfficeConfig();
  const envRaw = process.env.BUREAU_PUBLIC_ORIGIN?.trim() ?? "";
  const envOrigin = envRaw ? normalizePublicOrigin(envRaw) : null;
  const effectiveExternal = cfg.externalAccess !== null ? cfg.externalAccess : cfg.publicOrigin !== null || envOrigin !== null;
  return {
    externalAccess: effectiveExternal,
    publicOrigin: cfg.publicOrigin,
    envOriginSet: envRaw.length > 0,
    envOrigin,
    boundLoopback: isProcessBoundLoopback(),
    officeName: cfg.officeName,
  };
}

async function saveAccessSettingsForApi(actorUserId: string, input: { externalAccess: boolean; publicOrigin: string }): Promise<SetAccessResult> {
  const rawOrigin = input.publicOrigin.trim();
  const publicOrigin = rawOrigin ? normalizePublicOrigin(rawOrigin) : null;
  if (rawOrigin && !publicOrigin) {
    return { ok: false, status: 400, error: "Public URL must be https://<host> or http://localhost (no path, query, or fragment)." };
  }
  if (input.externalAccess && !publicOrigin) {
    return { ok: false, status: 400, error: "Enabling external access requires a public URL." };
  }

  const envRaw = process.env.BUREAU_PUBLIC_ORIGIN?.trim() ?? "";
  const envOrigin = envRaw ? normalizePublicOrigin(envRaw) : null;
  if (input.externalAccess && envOrigin && publicOrigin && envOrigin !== publicOrigin) {
    return {
      ok: false,
      status: 409,
      error: `BUREAU_PUBLIC_ORIGIN is still set to ${envOrigin}. Remove it from the service environment or set the Public URL to the same value, then save again.`,
      envOrigin,
    };
  }

  const prevCfg = loadOfficeConfig();
  try {
    saveOfficeConfig({
      prompt: prevCfg.prompt,
      envFile: prevCfg.envFile,
      publicOrigin,
      externalAccess: input.externalAccess,
      officeName: prevCfg.officeName,
    });
  } catch (err) {
    return { ok: false, status: 500, error: err instanceof Error ? err.message : "failed to save access settings" };
  }

  let signInUrl: string | null = null;
  if (input.externalAccess && publicOrigin) {
    const actor = getUserById(actorUserId);
    if (actor) {
      const minted = await mintInvite({
        username: actor.name,
        role: actor.role,
        createdBy: actor.name,
        allowExisting: true,
        replacePriorForUsername: true,
      });
      if (minted.ok) {
        signInUrl = `${publicOrigin}/i/${minted.rawToken}`;
        pushInvitesListToEachWs();
      } else {
        console.warn(`[auth] access settings self-invite mint failed: ${minted.error}`);
      }
    }
  }

  setOfficeName(prevCfg.officeName);
  return { ok: true, signInUrl, restartRequired: true };
}

function applyViewPreference(userId: string, change: ViewChangeInput): boolean {
  const actor = getUserById(userId);
  const updated = updateUser(actor, userId, change, AgentManager.getRooms());
  if (!updated) return false;
  for (const browser of browsers) sendInitialPayload(browser);
  refreshPresenceForUser(updated.id, { name: updated.name, avatarColor: updated.avatarColor, avatarVariant: updated.avatarVariant }, new Set(updated.allowedRooms));
  pushPresenceListToEachWs();
  return true;
}

async function updateUserForApi(actorUserId: string, actorRole: "owner" | "member", username: string, changes: UserRecordChanges): Promise<UserMutationResult> {
  const actor = getUserById(actorUserId);
  const target = getUserByName(username);
  if (!actor || !target) return { ok: false, status: 404, error: "user not found" };
  if (actorRole !== "owner" && actor.id !== target.id) return { ok: false, status: 403, error: "forbidden" };
  if (typeof changes.envFile === "string" && changes.envFile.trim()) {
    try {
      AgentManager.validateEnvPath(changes.envFile.trim());
    } catch (err) {
      return { ok: false, status: 422, error: err instanceof Error ? err.message : "invalid env file" };
    }
  }
  const updated = updateUser(actor, target.id, changes, AgentManager.getRooms());
  if (!updated) return { ok: false, status: 404, error: "user not found" };
  for (const browser of browsers) sendInitialPayload(browser);
  refreshPresenceForUser(updated.id, { name: updated.name, avatarColor: updated.avatarColor, avatarVariant: updated.avatarVariant }, new Set(updated.allowedRooms));
  pushPresenceListToEachWs();
  return { ok: true, user: updated };
}

async function setUserAccessForApi(actorUserId: string, username: string, allowedRooms: string[]): Promise<UserMutationResult> {
  const actor = getUserById(actorUserId);
  const target = getUserByName(username);
  if (!actor || actor.role !== "owner") return { ok: false, status: 403, error: "owner access required" };
  if (!target) return { ok: false, status: 404, error: "user not found" };
  const updated = updateUser(actor, target.id, { allowedRooms }, AgentManager.getRooms());
  if (!updated) return { ok: false, status: 404, error: "user not found" };
  for (const browser of browsers) sendInitialPayload(browser);
  refreshPresenceForUser(updated.id, { name: updated.name, avatarColor: updated.avatarColor, avatarVariant: updated.avatarVariant }, new Set(updated.allowedRooms));
  pushPresenceListToEachWs();
  return { ok: true, user: updated };
}

async function deleteUserForApi(actorUserId: string, actorRole: "owner" | "member", username: string): Promise<UserDeleteResult> {
  const target = getUserByName(username);
  if (!target) return { ok: false, status: 404, error: "user not found" };
  if (actorRole !== "owner" && actorUserId !== target.id) return { ok: false, status: 403, error: "forbidden" };
  if (actorRole === "owner" && actorUserId === target.id) return { ok: false, status: 409, error: "owners cannot delete their own user record" };
  if (wouldDeleteLeaveNoOwner(target.id)) return { ok: false, status: 409, error: "would leave office without an owner" };
  if (!deleteUserById(target.id)) return { ok: false, status: 404, error: "user not found" };
  for (const browser of browsers) sendInitialPayload(browser);
  await evictSessionsForUserId(target.id);
  return { ok: true };
}

const server = Bun.serve<WsData>({
  // Bun's default is ~128MB, below our 200MB per-file / 400MB per-upload limits,
  // so a large upload would 413 at the HTTP layer before reaching the handler.
  // Keep this above MAX_TOTAL (see server/http/files.ts).
  maxRequestBodySize: 512 * 1024 * 1024, // 512MB
  // Bind decision is locked to the boot-frozen externalAccess: loopback-only
  // pre-claim OR when external access is off; widened to all interfaces
  // (host: undefined → Bun's default 0.0.0.0) only when the office has been
  // claimed AND externalAccess is true. A mid-process claim does NOT widen
  // the bind; the operator restarts after flipping the Access pane toggle.
  ...(socketPath
    ? { unix: socketPath }
    : {
        port: PORT,
        hostname: isProcessPreClaim() || !boundExternal() ? "127.0.0.1" : "0.0.0.0",
      }),
  async fetch(req, server) {
    const url = new URL(req.url);

    // Auth-state routes (claim form, invite peek/accept, logout). These run
    // BEFORE any cookie gate — they're how an unauthenticated visitor
    // transitions to authenticated.
    const authRouted = await tryHandleAuthRoute(req, url, getOfficeName(), server);
    if (authRouted) return authRouted;

    // WebSocket upgrade — gated by both Origin and a valid session cookie
    // (loopback peers bypass the cookie check).
    if (url.pathname === "/ws") {
      if (!originAllowed(req, url)) {
        return new Response("Forbidden", { status: 403 });
      }
      const auth = authenticate(req, server, { allowLoopback: false, officeName: getOfficeName() });
      if (auth.kind === "rejected") return auth.response;
      const session = auth.kind === "ok" ? auth.session : null;
      if (server.upgrade(req, { data: { session } satisfies WsData })) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    if (!stateChangingOriginAllowed(req, url)) {
      return new Response("Forbidden", { status: 403 });
    }

    // Live-reload SSE — agent/dev tooling on the same host; no auth.
    const liveReload = handleLiveReloadRequest(req, url);
    if (liveReload) return liveReload;

    // Backup status — owner ops; auth-gated.
    if (url.pathname === "/backup/status" && req.method === "GET") {
      const auth = authenticate(req, server, { allowLoopback: true, officeName: getOfficeName() });
      if (auth.kind === "rejected") return auth.response;
      return new Response(JSON.stringify(getBackupStatus()), {
        headers: { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" },
      });
    }

    // Task / cronjob / files / agents HTTP APIs. Loopback-allowed because
    // local agents legitimately hit them; non-loopback callers need a
    // session cookie.
    const httpAuth = authenticate(req, server, { allowLoopback: true, officeName: getOfficeName() });
    if (httpAuth.kind === "rejected") return httpAuth.response;

    const tasksResp = await handleTasksRequest(req, url, httpAuth);
    if (tasksResp) return tasksResp;

    const cronjobsResp = await handleCronjobsRequest(req, url, httpAuth);
    if (cronjobsResp) return cronjobsResp;

    const pluginsResp = await handlePluginsRequest(req, url);
    if (pluginsResp) return pluginsResp;

    const filesResp = await handleFilesRequest(req, url, httpAuth);
    if (filesResp) return filesResp;

    const agentsResp = await handleAgentsRequest(req, url, httpAuth);
    if (agentsResp) return agentsResp;

    const editorResp = await handleEditorRequest(req, url, httpAuth, {
      verifyConnection: (connectionId, sessionIdHash) => findBrowserConnection(connectionId, sessionIdHash) !== null,
      watchFile: watchEditorFile,
      closeWatch: closeEditorWatch,
    });
    if (editorResp) return editorResp;

    const roomsResp = await handleRoomsRequest(req, url, httpAuth, { pushPresence: pushPresenceListToEachWs });
    if (roomsResp) return roomsResp;

    const officeSettingsResp = await handleOfficeSettingsRequest(req, url, httpAuth);
    if (officeSettingsResp) return officeSettingsResp;

    const validateResp = await handleValidateRequest(req, url, httpAuth);
    if (validateResp) return validateResp;

    const backendsResp = await handleBackendsRequest(req, url, httpAuth);
    if (backendsResp) return backendsResp;

    const systemResp = handleSystemRequest(req, url, httpAuth, { getBackupStatus });
    if (systemResp) return systemResp;

    const sessionsResp = await handleSessionsRequest(req, url, httpAuth, {
      list: (userId, role) => (role === "owner" ? listActiveSessions() : listActiveSessionsForUserId(userId)),
      revoke: revokeSessionForApi,
      logout: logoutSessionForApi,
    });
    if (sessionsResp) return sessionsResp;

    const invitesResp = await handleInvitesRequest(req, url, httpAuth, {
      list: (username, role) => (role === "owner" ? listInvites() : listInvitesForUsername(username)),
      mint: mintInviteForApi,
      mintSelf: mintSelfInviteForApi,
      revoke: revokeInviteForApi,
    });
    if (invitesResp) return invitesResp;

    const accessResp = await handleAccessRequest(req, url, httpAuth, {
      get: readAccessSettingsForApi,
      set: (input) => {
        if (httpAuth.kind !== "ok") return Promise.resolve({ ok: false, status: 401, error: "authenticated browser session required" });
        return saveAccessSettingsForApi(httpAuth.session.userId, input);
      },
    });
    if (accessResp) return accessResp;

    const usersResp = await handleUsersRequest(req, url, httpAuth, {
      update: updateUserForApi,
      setAccess: setUserAccessForApi,
      delete: deleteUserForApi,
    });
    if (usersResp) return usersResp;

    const viewResp = await handleViewRequest(req, url, httpAuth, { applyView: applyViewPreference });
    if (viewResp) return viewResp;

    const memoryResp = await handleMemoryRequest(req, url, httpAuth);
    if (memoryResp) return memoryResp;

    // SPA shell — auth-gated; an unauthenticated visitor lands on the
    // login page (or the claim form pre-claim).
    {
      const auth = authenticate(req, server, { allowLoopback: false, officeName: getOfficeName() });
      if (auth.kind === "rejected") return auth.response;
    }
    return handleStaticRequest(req, url);
  },
  websocket: {
    open(ws) {
      browsers.add(ws);
      const session = ws.data?.session ?? null;
      if (session) {
        registerSocket(session.sessionIdHash, ws);
        // Bind the WS to the authenticated user record automatically. The
        // user already exists in users.json (created via the invite/claim
        // flow); this hooks the WS into the existing per-WS lifecycle
        // (wsUsers / sessionPrefixes / connectedAt) that the rest of
        // bureau's command handlers depend on. claim_user is still wired
        // for loopback connections (agents on the same host) that arrive
        // without a session.
        claimUser(ws, session.username, AgentManager.getRooms());
        // Install the real auth-session prefix so SessionContext.currentSessionPrefix
        // matches the Access pane's session row for self-detection.
        setWsSessionPrefix(ws, session.sessionPrefix);
      }
      sendInitialPayload(ws);
    },
    message(ws, data) {
      // Per-message session recheck so a revoke from the Access pane
      // disconnects an active connection within ~1s. Loopback connections
      // (ws.data.session === null) skip the check.
      const session = ws.data?.session ?? null;
      if (session) {
        const current = revalidateByHash(session.sessionIdHash);
        if (!current) {
          try {
            ws.send(JSON.stringify({ type: "session_expired" } as ServerMessage));
          } catch {}
          try {
            ws.close();
          } catch {}
          return;
        }
      }
      try {
        const cmd = JSON.parse(data as string) as ClientCommand;
        handleCommand(cmd, ws);
      } catch (e) {
        console.error("Invalid command:", e);
      }
    },
    close(ws) {
      browsers.delete(ws);
      const session = ws.data?.session ?? null;
      if (session) unregisterSocket(session.sessionIdHash, ws);
      if (getSessionContext(ws)?.connectionId && removePresence(getSessionContext(ws)!.connectionId)) {
        pushPresenceListToEachWs();
      }
      clearWsUser(ws);
      closeEditorWatchesFor(ws);
    },
  },
});

// Start update checker
onUpdateChange((status) => {
  broadcast({ type: "update_status", updateAvailable: status.updateAvailable, current: status.current, latest: status.latest } as ServerMessage);
});
startUpdateChecker();

// Plugin load + agent restore are sequenced inside the same async boot so
// RESTORED agents come up with the full plugin set already in place. A
// fire-and-forget plugin load would race with restoreAgents — a slow
// plugin import could let restored-agent turns dispatch with
// getEnabledPlugins() empty.
//
// Caveat: `Bun.serve` above already bound the HTTP listener BEFORE this
// IIFE started. A user who spawns a brand-new agent during the small
// plugin-load window (typically <100ms; longer if a plugin's transitive
// deps need fetching) and immediately sends them a message will see that
// agent's first turn run without plugin hooks. We accept this for v0:
// gating HTTP on plugin load would let a single broken local plugin stall
// the whole UI, which is a worse failure mode than one plugin-less first
// turn.
//
// Plugin load failures land in ~/.bureau/logs/plugins.jsonl + stderr and
// don't block startup; we still proceed to restoreAgents on the catch path
// so a broken plugin doesn't kill the server.
void (async () => {
  try {
    // import.meta.dir points at server/, so go up one to get the repo root.
    const bureauRoot = joinPath(import.meta.dir, "..");
    const enabledPlugins = loadEnabledPlugins();
    await loadPlugins({ bureauRoot, enabledPlugins });
  } catch (err) {
    console.error("[plugins] unexpected error during plugin load:", err);
  }

  const restored = await AgentManager.restoreAgents();
  if (restored.length > 0) {
    console.log(`Restored ${restored.length} agent(s): ${restored.map((a) => a.name).join(", ")}`);
  }
})();

// Boot cronjob scheduler (loads configs, reconciles stale "running" rows, starts tick).
CronjobManager.startCronjobScheduler();

// Daily ~/.bureau/ backup tarball with N=7 retention. See server/backup.ts.
startBackupScheduler();

// Admin Unix socket — lets the `owner-login` CLI mint a recovery URL for
// a stranded owner. No-op (with a logged warning) if the socket can't be
// created; the rest of the server boots normally.
startAdminSocket();

printStartupBanner({
  socketPath,
  port: PORT,
  publicOrigin: getPublicOrigin(),
  preClaim: isProcessPreClaim(),
});
