import type { Server } from "bun";
import { getBackupStatus } from "../backup.ts";
import { closeEditorWatch, findBrowserConnection, watchEditorFile } from "../editor-watchers.ts";
import { getOfficeName, listActiveSessions, listActiveSessionsForUserId, listInvites, listInvitesForUsername } from "../auth/auth.ts";
import { authenticate } from "../auth/auth-middleware.ts";
import { tryHandleAuthRoute } from "../auth/auth-routes.ts";
import { getPublicOrigin, originAllowed, stateChangingOriginAllowed } from "../public-origin.ts";
import { pushPresenceListToEachWs } from "../ws-initial-payload.ts";
import type { WsData } from "../ws/websocket-handlers.ts";
import {
  applyViewPreference,
  deleteUserForApi,
  logoutSessionForApi,
  mintInviteForApi,
  mintSelfInviteForApi,
  readAccessSettingsForApi,
  revokeInviteForApi,
  revokeSessionForApi,
  saveAccessSettingsForApi,
  setUserAccessForApi,
  updateUserForApi,
} from "./access-adapters.ts";
import { handleAccessRequest } from "./access.ts";
import { handleAgentsRequest } from "./agents.ts";
import { handleBackendsRequest } from "./backends.ts";
import { handleCronjobsRequest } from "./cronjobs.ts";
import { handleEditorRequest } from "./editor.ts";
import { handleFilesRequest } from "./files.ts";
import { handleInvitesRequest } from "./invites.ts";
import { handleLiveReloadRequest } from "./live-reload.ts";
import { handleMemoryRequest } from "./memory.ts";
import { handleOfficeSettingsRequest } from "./office-settings.ts";
import { handlePluginsRequest } from "./plugins.ts";
import { handleRoomsRequest } from "./rooms.ts";
import { handleSessionsRequest } from "./sessions.ts";
import { handleStaticRequest } from "./static.ts";
import { handleSystemRequest } from "./system.ts";
import { handleTasksRequest } from "./tasks.ts";
import { handleUsersRequest } from "./users.ts";
import { handleValidateRequest } from "./validate.ts";
import { handleViewRequest } from "./view.ts";

export function createFetchHandler() {
  return async function fetch(req: Request, server: Server<WsData>) {
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
  };
}
