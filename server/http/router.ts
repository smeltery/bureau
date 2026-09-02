import type { Server } from "bun";
import { getBackupStatus } from "../backup.ts";
import { closeEditorWatch, findBrowserConnection, watchEditorFile } from "../editor-watchers.ts";
import { getVersionInfo } from "../version.ts";
import { getOfficeName, listActiveSessions, listActiveSessionsForUserId, listInvites, listInvitesForUsername, readSessionCookies, sessionCookieMigrationHeaders } from "../auth/auth.ts";
import { authenticate } from "../auth/auth-middleware.ts";
import { withSecurityHeaders } from "../auth/auth-pages.ts";
import { tryHandleAuthRoute } from "../auth/auth-routes.ts";
import { getPublicOrigin, originAllowed, stateChangingOriginAllowed } from "../public-origin.ts";
import { pushPresenceListToEachWs } from "../ws-initial-payload.ts";
import type { WsData } from "../ws/websocket-handlers.ts";
import { handleApiTokensRequest } from "../auth/api-tokens-route.ts";
import { applyViewPreference, deleteUserForApi, listAccessibleRoomsForApi, readAccessSettingsForApi, saveAccessSettingsForApi, setUserAccessForApi, updateUserForApi } from "./access-adapters.ts";
import { mintInviteForApi, mintRecoveryInviteForApi, mintSelfInviteForApi, revokeInviteForApi } from "./access-invite-adapters.ts";
import { logoutSessionForApi, revokeSessionForApi } from "./access-session-adapters.ts";
import { handleAccessRequest } from "./access.ts";
import { handleAgentSlidesRequest } from "./agent-slides.ts";
import { defaultSlideRoutesDeps } from "./agent-slides-deps.ts";
import { handleAgentsRequest } from "./agents.ts";
import { handleAppSelfRequest } from "./app-self.ts";
import { handleAppsRequest } from "./apps.ts";
import { appHostDomain } from "../apps/domain.ts";
import { appRegistry } from "../apps/registry.ts";
import { handleTlsAsk, TLS_ASK_PATH } from "../apps/tls-ask.ts";
import { handleAppHostRequest } from "../apps/host/dispatch.ts";
import { APP_MINT_PATH, handleAppMintRequest } from "../apps/host/auth.ts";
import { handleBackendsRequest } from "./backends.ts";
import { handleCronjobsRequest } from "./cronjobs.ts";
import { handleEditorRequest } from "./editor.ts";
import { handleFilesRequest } from "./files.ts";
import { handleInvitesRequest } from "./invites.ts";
import { handleLiveReloadRequest } from "./live-reload.ts";
import { handleMemoryRequest } from "./memory.ts";
import { handleEnvSettingsRequest, handleOfficeSettingsRequest } from "./office-settings.ts";
import { handlePluginsRequest } from "./plugins.ts";
import { handleReadyRequest } from "./ready.ts";
import { handleRoomsRequest } from "./rooms.ts";
import { handleSessionsRequest } from "./sessions.ts";
import { handleSkillUsageRequest } from "./skill-usage.ts";
import { handleStaticRequest } from "./static.ts";
import { handleStorageRequest } from "./storage.ts";
import { handleSystemRequest } from "./system.ts";
import { handleTasksRequest } from "./tasks.ts";
import { handleUsageRequest } from "./usage.ts";
import { handleUsersRequest } from "./users.ts";
import { handleValidateRequest } from "./validate.ts";
import { handleViewRequest } from "./view.ts";

export function createFetchHandler() {
  return async function fetch(req: Request, server: Server<WsData>) {
    const response = await routeFetch(req, server);
    return response ? withSecurityHeaders(response) : response;
  };
}

async function routeFetch(req: Request, server: Server<WsData>): Promise<Response | undefined> {
  // FIRST, before the URL is parsed and before any office route runs: is this
  // request for one of the office's apps rather than the office itself? A
  // strict child of the office host is diverted and NO handler below ever sees
  // it — app hostnames sit under a wildcard record, so anyone can point any
  // name under it at this server, and none of those names may reach the
  // office's own surface. Returns null on every office request, and on every
  // install that has no app-host domain at all. See server/apps/host/
  // dispatch.ts.
  const diverted = handleAppHostRequest(req, {
    peer: () => server.requestIP(req)?.address,
    upgrade: (request, data, headers) => server.upgrade(request, { data, ...(headers ? { headers } : {}) }),
  });
  if (diverted !== null) return diverted;

  const url = new URL(req.url);

  const readyResp = handleReadyRequest(req, url, { server, now: Date.now });
  if (readyResp) return readyResp;

  if (url.pathname === "/.well-known/security.txt" && (req.method === "GET" || req.method === "HEAD")) {
    return new Response(req.method === "HEAD" ? null : securityTxt(), {
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }

  // The certificate-admission gate for app hostnames. A TLS terminator in
  // front of the office asks it before serving a name under the wildcard, so
  // it answers BEFORE any auth: the caller is a terminator on loopback, not a
  // browser with a session, and the answer is a function of the registry
  // alone. Refuses everything on an office with no app-host domain, which is
  // every plain-HTTP and Tailscale-only install. See server/apps/tls-ask.ts.
  if (url.pathname === TLS_ASK_PATH && req.method === "GET") {
    return handleTlsAsk(url, { domain: appHostDomain(), admit: (label) => appRegistry.admitAppCertificate(label) });
  }

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
    const auth = authenticate(req, server, { allowLoopback: false, officeName: getOfficeName(), gate: "ws" });
    if (auth.kind === "rejected") return auth.response;
    const session = auth.kind === "ok" ? auth.session : null;
    // The __Host- cookie migration rides the 101. This is the seam that
    // reaches an already-open tab: a running SPA can reconnect its socket
    // for days without ever loading a page again, so a page-load-only
    // migration would leave exactly the population the hardening is for.
    // Multi-value MUST go through Headers.append — an array passed in a
    // plain object is dropped.
    const wsMigration = session ? sessionCookieMigrationHeaders(readSessionCookies(req), session) : [];
    const wsHeaders = new Headers();
    for (const line of wsMigration) wsHeaders.append("Set-Cookie", line);
    if (server.upgrade(req, { data: { session } satisfies WsData, ...(wsMigration.length > 0 ? { headers: wsHeaders } : {}) })) return;
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

  // Ahead of the general agent routes: those answer null for /slides paths, so
  // the order is documentation rather than dispatch, but it keeps the Slide
  // Mode surface findable next to the routes it belongs beside.
  const slidesResp = await handleAgentSlidesRequest(req, url, httpAuth, defaultSlideRoutesDeps);
  if (slidesResp) return slidesResp;

  const agentsResp = await handleAgentsRequest(req, url, httpAuth);
  if (agentsResp) return agentsResp;

  const appsResp = await handleAppsRequest(req, url, httpAuth);
  if (appsResp) return appsResp;

  // The app-SELF surface: authenticated by an app token, never by a session.
  const appSelfResp = await handleAppSelfRequest(req, url);
  if (appSelfResp) return appSelfResp;

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

  const systemResp = handleSystemRequest(req, url, httpAuth, { getBackupStatus, getVersion: getVersionInfo });
  if (systemResp) return systemResp;

  const storageResp = await handleStorageRequest(req, url, httpAuth);
  if (storageResp) return storageResp;

  const usageResp = handleUsageRequest(req, url, httpAuth);
  if (usageResp) return usageResp;

  const skillUsageResp = handleSkillUsageRequest(req, url, httpAuth);
  if (skillUsageResp) return skillUsageResp;

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
    mintRecovery: mintRecoveryInviteForApi,
    revoke: revokeInviteForApi,
  });
  if (invitesResp) return invitesResp;

  const apiTokensResp = await handleApiTokensRequest(req, url, httpAuth);
  if (apiTokensResp) return apiTokensResp;

  const accessResp = await handleAccessRequest(req, url, httpAuth, {
    get: readAccessSettingsForApi,
    set: (input) => {
      if (httpAuth.kind !== "ok") return Promise.resolve({ ok: false, status: 401, error: "authenticated browser session required" });
      return saveAccessSettingsForApi(httpAuth.session.userId, input);
    },
  });
  if (accessResp) return accessResp;

  const envSettingsResp = await handleEnvSettingsRequest(req, url, httpAuth);
  if (envSettingsResp) return envSettingsResp;

  const usersResp = await handleUsersRequest(req, url, httpAuth, {
    update: updateUserForApi,
    setAccess: setUserAccessForApi,
    delete: deleteUserForApi,
  });
  if (usersResp) return usersResp;

  const viewResp = await handleViewRequest(req, url, httpAuth, {
    applyView: applyViewPreference,
    listAccessibleRooms: listAccessibleRoomsForApi,
  });
  if (viewResp) return viewResp;

  const memoryResp = await handleMemoryRequest(req, url, httpAuth);
  if (memoryResp) return memoryResp;

  // The office half of the app sign-in handshake: mint a single-use code for
  // an app the caller may reach. On the OFFICE host (this is not an app host —
  // dispatch above already diverted those), so it is the one place in the flow
  // that can see an office session cookie. Auth-gated like any office page:
  // an anonymous caller is bounced to the login page and arrives back here.
  if (url.pathname === APP_MINT_PATH) {
    const auth = authenticate(req, server, { allowLoopback: false, officeName: getOfficeName() });
    if (auth.kind === "rejected") return auth.response;
    if (auth.kind !== "ok") return new Response("unauthenticated", { status: 401 });
    return handleAppMintRequest(req, url, auth.session, { appHostDomain: appHostDomain() });
  }

  // SPA shell — auth-gated; an unauthenticated visitor lands on the
  // login page (or the claim form pre-claim). The shell also carries the
  // __Host- cookie migration (the seam for a plain page load or reload);
  // only a cookie-authenticated session migrates — a loopback caller's
  // incidental cookie is not what authenticated the request.
  const auth = authenticate(req, server, { allowLoopback: false, officeName: getOfficeName() });
  if (auth.kind === "rejected") return auth.response;
  const staticResp = await handleStaticRequest(req, url);
  if (auth.kind === "ok") {
    for (const line of sessionCookieMigrationHeaders(readSessionCookies(req), auth.session)) {
      staticResp.headers.append("Set-Cookie", line);
    }
  }
  return staticResp;
}

function securityTxt(): string {
  return [
    "Contact: https://github.com/dotbrains/bureau/security/advisories/new",
    "Expires: 2027-08-24T00:00:00Z",
    "Preferred-Languages: en",
    "Canonical: https://github.com/dotbrains/bureau/security/policy",
    "Policy: https://github.com/dotbrains/bureau/security/policy",
    "",
  ].join("\n");
}
