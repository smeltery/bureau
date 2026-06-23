import type { ClientCommand, KilledAgentSummary, PresenceInfo, ServerMessage } from "../shared/types.ts";
import { KILLED_AGENT_CHIP_CAP } from "../shared/types.ts";
import * as AgentManager from "./agent-manager.ts";
import * as CronjobManager from "./cronjobs/index.ts";
import { loadEnabledPlugins, loadOfficeConfig, loadRecentCwds, saveOfficeConfig } from "./persistence.ts";
import { loadPlugins } from "./plugins/registry.ts";
import { join as joinPath } from "path";
import { getUpdateStatus, onUpdateChange, startUpdateChecker } from "./update-checker.ts";
import { getBackupStatus, startBackupScheduler } from "./backup.ts";
import { broadcast, browsers, tasks } from "./ws/broadcast.ts";
import { handleCommand } from "./ws/commands.ts";
import { stopWatch, type FileWatcher } from "./file-editor.ts";
import { canSeeRoom, claimUser, clearWsUser, getSessionContext, getWsUser, listUsers, projectAgents, projectRooms, setWsSessionPrefix } from "./users.ts";
import { listAllPresence, removePresence } from "./presence.ts";

// Per-WS editor file watchers. Each open file gets one fs.watch handle keyed
// by `${agentId}\0${absPath}` so the same path can be watched independently
// across agents. Watchers close on editor_close or WS disconnect.
export const editorWatchers = new WeakMap<import("bun").ServerWebSocket<unknown>, Map<string, FileWatcher>>();
import { handleLiveReloadRequest, startLiveReloadWatcher } from "./http/live-reload.ts";
import { handleTasksRequest } from "./http/tasks.ts";
import { handleCronjobsRequest } from "./http/cronjobs.ts";
import { handlePluginsRequest } from "./http/plugins.ts";
import { handleFilesRequest } from "./http/files.ts";
import { handleAgentsRequest } from "./http/agents.ts";
import { handleStaticRequest } from "./http/static.ts";
import { getPublicOrigin, originAllowed, stateChangingOriginAllowed } from "./public-origin.ts";
import { authenticate, setOnOwnerCreated, tryHandleAuthRoute } from "./auth/auth-middleware.ts";
import {
  freezeBootState,
  getOfficeName,
  isProcessPreClaim,
  registerSocket,
  revalidateByHash,
  setOfficeName,
  setOnInviteConsumed,
  setOnSessionsChanged,
  setPublicOriginFallback,
  setRoomsSnapshotProvider,
  unregisterSocket,
  validateSession,
  listActiveSessions,
  listInvites,
  type SessionLookup,
} from "./auth/auth.ts";
import { startAdminSocket } from "./auth/admin-socket.ts";
import { normalizePublicOrigin } from "../shared/public-origin.ts";
import { hostname as osHostname, userInfo } from "os";

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

// ---------------------------------------------------------------------------
// Boot block: resolve access settings, migrate the deprecated env var,
// backfill externalAccess to disk, then freeze cookie/bind state for the
// lifetime of the process. Order matters: every auth/origin codepath below
// reads the frozen state, and a mid-process claim must not change the bind
// decision the cookie attributes were minted against.
{
  let cfg = loadOfficeConfig();
  const envRaw = process.env.BUREAU_PUBLIC_ORIGIN?.trim();
  const envOrigin = envRaw ? normalizePublicOrigin(envRaw) : null;

  // Env-var migration. BUREAU_PUBLIC_ORIGIN is deprecated; copy its value
  // into office-config.json (only when JSON's slot is empty, never clobber
  // an explicit JSON value) and warn the operator. The env var still wins
  // for THIS boot via buildPublicOrigin's precedence chain.
  let configDirty = false;
  if (envOrigin) {
    if (cfg.publicOrigin === null) {
      console.log(
        `[auth] BUREAU_PUBLIC_ORIGIN is deprecated. Migrating "${envOrigin}" into office-config.json so it survives without the env var. Remove BUREAU_PUBLIC_ORIGIN from your env on your next deploy.`,
      );
      cfg = { ...cfg, publicOrigin: envOrigin };
      configDirty = true;
    } else if (cfg.publicOrigin === envOrigin) {
      console.log(`[auth] BUREAU_PUBLIC_ORIGIN env var is redundant with office-config.json#publicOrigin (${cfg.publicOrigin}) and is deprecated. Remove it from your env on your next deploy.`);
    } else {
      console.error(
        `[auth] BUREAU_PUBLIC_ORIGIN ("${envOrigin}") differs from office-config.json#publicOrigin ("${cfg.publicOrigin}"). The env var is deprecated; bureau uses the env value for THIS boot but will use the JSON value once the env var is removed. Reconcile by editing one and removing the other.`,
      );
    }
  }

  // External-access backfill. When the field is absent from JSON
  // (pre-redesign install), default to true if any publicOrigin source
  // exists so the office stays reachable at its old address after the
  // upgrade. Write the resolved value back so subsequent boots don't
  // re-run this inference.
  let externalAccess: boolean;
  if (cfg.externalAccess !== null) {
    externalAccess = cfg.externalAccess;
  } else {
    externalAccess = cfg.publicOrigin !== null || envOrigin !== null;
    configDirty = true;
  }

  if (configDirty) {
    try {
      saveOfficeConfig({
        prompt: cfg.prompt,
        envFile: cfg.envFile,
        publicOrigin: cfg.publicOrigin,
        externalAccess,
        officeName: cfg.officeName,
      });
    } catch (err) {
      console.error(`[auth] failed to backfill office-config.json (${(err as Error).message}); will re-attempt next boot`);
    }
  }

  setPublicOriginFallback(cfg.publicOrigin);
  setOfficeName(cfg.officeName);
  freezeBootState({ externalAccess });
}

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
// hook is intentionally a no-op for now. The hook exists for parity with
// isomux's welcome-agents flow and as the supported extension point.
setOnOwnerCreated(async ({ username }) => {
  void username;
});

function sendToVisibleAgent(agentId: string, msg: ServerMessage) {
  const agent = AgentManager.getAllAgents().find((a) => a.id === agentId);
  const roomId = agent ? AgentManager.getRooms()[agent.room]?.id : null;
  for (const ws of browsers) {
    const user = getWsUser(ws);
    if (!roomId || canSeeRoom(user, roomId)) {
      if (msg.type === "agent_updated" && typeof msg.changes.room === "number" && user?.role === "member") {
        const projectedRooms = projectRooms(user, AgentManager.getRooms());
        const projectedRoom = projectedRooms.findIndex((r) => r.id === roomId);
        ws.send(JSON.stringify({ ...msg, changes: { ...msg.changes, room: projectedRoom } } as ServerMessage));
      } else if (msg.type === "agent_added" && user?.role === "member") {
        const projected = projectAgents(user, [msg.agent], AgentManager.getRooms())[0];
        if (projected) ws.send(JSON.stringify({ ...msg, agent: projected } as ServerMessage));
      } else {
        ws.send(JSON.stringify(msg));
      }
    }
  }
}

function buildPresenceListFor(ws: import("bun").ServerWebSocket<unknown>): PresenceInfo[] {
  const user = getWsUser(ws);
  const rooms = AgentManager.getRooms();
  const projectedRooms = projectRooms(user, rooms);
  const visibleIndexById = new Map(projectedRooms.map((room, index) => [room.id, index]));
  const entries: PresenceInfo[] = [];
  for (const presence of listAllPresence()) {
    if (!presence.currentRoomId) continue;
    const currentRoom = visibleIndexById.get(presence.currentRoomId);
    if (currentRoom === undefined) continue;
    entries.push({
      connectionId: presence.connectionId,
      userId: presence.userId,
      username: presence.username,
      device: presence.device,
      avatarColor: presence.avatarColor,
      avatarVariant: presence.avatarVariant,
      currentRoom,
      focusedAgentId: presence.focusedAgentId,
      viewMode: presence.viewMode,
    });
  }
  entries.sort((a, b) => a.connectionId.localeCompare(b.connectionId));
  return entries;
}

function countTotalOnlineUsers(): number {
  return new Set(listAllPresence().map((presence) => presence.userId)).size;
}

export function pushPresenceListToEachWs() {
  for (const ws of browsers) {
    ws.send(JSON.stringify({ type: "presence_list", entries: buildPresenceListFor(ws), totalOnlineUsers: countTotalOnlineUsers() } as ServerMessage));
  }
}

// Wire AgentManager events to WebSocket broadcasts, filtering agent-scoped
// events through each connection's room access.
AgentManager.onEvent((event) => {
  if (event.type === "log_entry") {
    sendToVisibleAgent(event.entry.agentId, event as ServerMessage);
    return;
  }
  if (event.type === "agent_added") {
    sendToVisibleAgent(event.agent.id, event as ServerMessage);
    return;
  }
  if (event.type === "agent_updated") {
    sendToVisibleAgent(event.agentId, event as ServerMessage);
    return;
  }
  if (event.type === "killed_agent_added") {
    const lastRoomId = event.agent.lastRoomId;
    for (const ws of browsers) {
      if (canSeeRoom(getWsUser(ws), lastRoomId)) ws.send(JSON.stringify(event as ServerMessage));
    }
    return;
  }
  if (event.type === "killed_agent_removed") {
    for (const ws of browsers) {
      if (canSeeRoom(getWsUser(ws), event.lastRoomId)) ws.send(JSON.stringify(event as ServerMessage));
    }
    return;
  }
  if (
    event.type === "agent_removed" ||
    event.type === "room_created" ||
    event.type === "room_closed" ||
    event.type === "room_renamed" ||
    event.type === "room_settings_updated" ||
    event.type === "rooms_reordered"
  ) {
    for (const ws of browsers) sendInitialPayload(ws);
    return;
  }
  broadcast(event as ServerMessage);
});

// Wire CronjobManager events to WebSocket broadcasts
CronjobManager.onCronjobEvent((event) => {
  broadcast(event as ServerMessage);
});

// Start the live-reload filesystem watcher (no-op unless BUREAU_LIVE_RELOAD=1)
startLiveReloadWatcher();

function readArgValue(name: string): string | null {
  const prefix = `${name}=`;
  for (let i = 2; i < Bun.argv.length; i++) {
    const arg = Bun.argv[i];
    if (arg === name) return Bun.argv[i + 1] ?? null;
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
  }
  return null;
}

const socketPath = readArgValue("--socket");
const portArg = readArgValue("--port");
const envPort = process.env.PORT;
const PORT = parseInt(portArg || process.env.PORT || "4000");

if (socketPath && (portArg || envPort)) {
  throw new Error("--socket is mutually exclusive with --port/PORT");
}

process.env.PORT = String(PORT);

// Per-WS auth context. Set at upgrade; cleared at close. WsData carries the
// session lookup so per-message rechecks can revoke active connections
// within ~1s of an Access-pane revoke. Loopback connections (agents on the
// same host) skip auth and run with `session === null`.
interface WsData {
  session: SessionLookup | null;
}

// ACL-filtered + capped killed-agent chips for a session. Filters by the room
// each agent was killed in (its history `lastRoomId`) so a member never sees a
// revive chip for an agent in a room they can't access; the cap is applied
// AFTER filtering so a restricted session still fills up to the cap.
function killedAgentsFor(ws: import("bun").ServerWebSocket<unknown>): KilledAgentSummary[] {
  const user = getWsUser(ws);
  return AgentManager.getKilledAgentSummaries()
    .filter((k) => canSeeRoom(user, k.lastRoomId))
    .slice(0, KILLED_AGENT_CHIP_CAP);
}

export function sendInitialPayload(ws: import("bun").ServerWebSocket<unknown>) {
  const user = getWsUser(ws);
  const rooms = AgentManager.getRooms();
  const agents = AgentManager.getAllAgents();
  const projectedRooms = projectRooms(user, rooms);
  const projectedAgents = projectAgents(user, agents, rooms);
  ws.send(
    JSON.stringify({
      type: "full_state",
      agents: projectedAgents,
      recentCwds: loadRecentCwds(),
      office: AgentManager.getOfficeSettings(),
      rooms: projectedRooms,
      allRooms: user?.role === "owner" ? rooms : undefined,
      killedAgents: killedAgentsFor(ws),
    } as ServerMessage),
  );
  ws.send(JSON.stringify({ type: "users_list", users: listUsers(rooms) } as ServerMessage));
  ws.send(JSON.stringify({ type: "session_context", context: getSessionContext(ws) } as ServerMessage));
  ws.send(JSON.stringify({ type: "tasks", tasks } as ServerMessage));
  ws.send(
    JSON.stringify({
      type: "cronjobs_state",
      cronjobs: CronjobManager.listCronjobs(),
      cronjobsPrompt: CronjobManager.getCronjobsPrompt(),
    } as ServerMessage),
  );
  const update = getUpdateStatus();
  if (update.updateAvailable) {
    ws.send(JSON.stringify({ type: "update_status", updateAvailable: true, current: update.current, latest: update.latest } as ServerMessage));
  }
  for (const agent of projectedAgents) {
    const logs = AgentManager.getAgentLogs(agent.id);
    for (const entry of logs) {
      ws.send(JSON.stringify({ type: "log_entry", entry } as ServerMessage));
    }
    const cmds = AgentManager.getAgentCommands(agent.id);
    if (cmds.commands.length > 0 || cmds.skills.length > 0) {
      ws.send(JSON.stringify({ type: "slash_commands", agentId: agent.id, commands: cmds.commands, skills: cmds.skills } as ServerMessage));
    }
  }
  ws.send(JSON.stringify({ type: "presence_list", entries: buildPresenceListFor(ws), totalOnlineUsers: countTotalOnlineUsers() } as ServerMessage));
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
    {
      const auth = authenticate(req, server, { allowLoopback: true, officeName: getOfficeName() });
      if (auth.kind === "rejected") return auth.response;
    }

    const tasksResp = await handleTasksRequest(req, url);
    if (tasksResp) return tasksResp;

    const cronjobsResp = await handleCronjobsRequest(req, url);
    if (cronjobsResp) return cronjobsResp;

    const pluginsResp = await handlePluginsRequest(req, url);
    if (pluginsResp) return pluginsResp;

    const filesResp = await handleFilesRequest(req, url);
    if (filesResp) return filesResp;

    const agentsResp = await handleAgentsRequest(req, url);
    if (agentsResp) return agentsResp;

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
      const map = editorWatchers.get(ws);
      if (map) {
        for (const w of map.values()) stopWatch(w);
        editorWatchers.delete(ws);
      }
    },
  },
});

// Effective external-access flag derived from the boot-frozen state. We
// can't import isProcessBoundLoopback at module top without inducing the
// cycle Bun.serve's options block sits in (it runs before freezeBootState
// finishes if we reference the predicate during options evaluation), so
// the wrapper queries the office config directly.
function boundExternal(): boolean {
  const cfg = loadOfficeConfig();
  // Loopback when externalAccess is explicitly false OR (when null) when
  // no publicOrigin source exists. Matches the boot block's default.
  if (cfg.externalAccess === false) return false;
  if (cfg.externalAccess === true) return true;
  return cfg.publicOrigin !== null || !!process.env.BUREAU_PUBLIC_ORIGIN;
}

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

const listenTarget = socketPath ? `unix:${socketPath}` : `http://localhost:${server.port}`;
console.log(`Bureau running at ${listenTarget}`);
console.log(`Bureau public origin: ${getPublicOrigin()}`);

if (isProcessPreClaim()) {
  // Pre-claim banner. The tokenless claim form is bound to 127.0.0.1, so
  // off-box operators have to SSH-tunnel in. Print a template with the
  // detected local user/host so the operator can copy-paste; the values
  // are hints (the operator may SSH as a different user).
  const detectedUser = (() => {
    try {
      return userInfo().username;
    } catch {
      return "user";
    }
  })();
  const detectedHost = (() => {
    try {
      return osHostname();
    } catch {
      return "host";
    }
  })();
  const port = String(server.port);
  console.log(`
================================================================
  Bureau: no owner has been set up for this office yet.

  TO CLAIM OWNERSHIP from THIS machine:
    Open http://localhost:${port} in your browser.

  TO CLAIM OWNERSHIP from another machine:
    1. On that machine, open a tunnel to this box:
         ssh -L ${port}:localhost:${port} <user>@<host>
       (this machine reports ${detectedUser}@${detectedHost}; use whatever you actually SSH as)
    2. Open http://localhost:${port} in that browser.

  After you claim, the Access pane (User Settings) lets you enable
  external access so everyday use doesn't need the SSH tunnel.
================================================================
`);
}
