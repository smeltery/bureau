import type { ServerMessage } from "../shared/types.ts";
import * as AgentManager from "./agent-manager.ts";
import * as CronjobManager from "./cronjobs/index.ts";
import { loadEnabledPlugins } from "./persistence.ts";
import { loadPlugins } from "./plugins/registry.ts";
import { join as joinPath } from "path";
import { onUpdateChange, startUpdateChecker } from "./update-checker.ts";
import { getBackupStatus, startBackupScheduler } from "./backup.ts";
import { broadcast } from "./ws/broadcast.ts";
import { closeEditorWatch, findBrowserConnection, watchEditorFile } from "./editor-watchers.ts";
export { editorWatchers } from "./editor-watchers.ts";
import { pushPresenceListToEachWs, sendInitialPayload } from "./ws-initial-payload.ts";
export { pushPresenceListToEachWs, sendInitialPayload } from "./ws-initial-payload.ts";
import { wireAgentAndCronjobEvents } from "./ws/agent-events.ts";
import { closeBrowserWebSocket, handleBrowserWebSocketMessage, openBrowserWebSocket, type WsData } from "./ws/websocket-handlers.ts";
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
import { handleViewRequest } from "./http/view.ts";
import { handleSystemRequest } from "./http/system.ts";
import { handleSessionsRequest } from "./http/sessions.ts";
import { handleInvitesRequest } from "./http/invites.ts";
import { handleAccessRequest } from "./http/access.ts";
import { handleUsersRequest } from "./http/users.ts";
import { handleStaticRequest } from "./http/static.ts";
import { getPublicOrigin, originAllowed, stateChangingOriginAllowed } from "./public-origin.ts";
import { authenticate, tryHandleAuthRoute } from "./auth/auth-middleware.ts";
import { getOfficeName, isProcessPreClaim, listActiveSessions, listActiveSessionsForUserId, listInvites, listInvitesForUsername } from "./auth/auth.ts";
import { startAdminSocket } from "./auth/admin-socket.ts";
import { installAuthCallbacks } from "./auth/auth-callbacks.ts";
import { boundExternal, initializeAccessConfig } from "./boot-access.ts";
import { printStartupBanner, resolveListenOptions } from "./boot-listen.ts";
import {
  applyViewPreference,
  deleteUserForApi,
  mintInviteForApi,
  mintSelfInviteForApi,
  readAccessSettingsForApi,
  revokeInviteForApi,
  revokeSessionForApi,
  logoutSessionForApi,
  saveAccessSettingsForApi,
  setUserAccessForApi,
  updateUserForApi,
} from "./http/access-adapters.ts";
import { pushInvitesListToEachWs, pushSessionsListToEachWs } from "./access-broadcasts.ts";

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

installAuthCallbacks(() => AgentManager.getRooms());

wireAgentAndCronjobEvents();

// Start the live-reload filesystem watcher (no-op unless BUREAU_LIVE_RELOAD=1)
startLiveReloadWatcher();

const { socketPath, port: PORT } = resolveListenOptions();

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
    open: openBrowserWebSocket,
    message: handleBrowserWebSocketMessage,
    close: closeBrowserWebSocket,
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
