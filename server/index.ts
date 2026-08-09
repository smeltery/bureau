import type { ServerMessage } from "../shared/types.ts";
import * as AgentManager from "./agent-manager.ts";
import * as CronjobManager from "./cronjobs/index.ts";
import { startScheduledMessageScheduler } from "./scheduled-messages.ts";
import { startIdleSessionEvictor } from "./agents/idle-sessions.ts";
import { loadEnabledPlugins } from "./persistence.ts";
import { loadPlugins } from "./plugins/registry.ts";
import { join as joinPath } from "path";
import { onUpdateChange, startUpdateChecker } from "./update-checker.ts";
import { startBackupScheduler } from "./backup.ts";
import { reconcileAppsAtBoot } from "./apps/boot.ts";
import { freezeAppHostDomain } from "./apps/domain.ts";
import { broadcast } from "./ws/broadcast.ts";
export { editorWatchers } from "./editor-watchers.ts";
export { pushPresenceListToEachWs, sendInitialPayload } from "./ws-initial-payload.ts";
import { wireAgentAndCronjobEvents } from "./ws/agent-events.ts";
import { closeBrowserWebSocket, handleBrowserWebSocketMessage, openBrowserWebSocket, type WsData } from "./ws/websocket-handlers.ts";
import { startLiveReloadWatcher } from "./http/live-reload.ts";
import { createFetchHandler } from "./http/router.ts";
import { getPublicOrigin } from "./public-origin.ts";
import { getOfficeName, isProcessPreClaim } from "./auth/auth.ts";
import { startAdminSocket } from "./auth/admin-socket.ts";
import { installAuthCallbacks } from "./auth/auth-callbacks.ts";
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

// Resolve the domain an office's apps hang off, ONCE, and only now: the
// derivation reads buildPublicOrigin, which does not answer for this boot until
// the line above has frozen the access config. Everything that writes an app's
// address into its unit — registration, reinstall, the boot pass below — reads
// this frozen value. See server/apps/domain.ts.
freezeAppHostDomain();

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
  fetch: createFetchHandler(),
  websocket: {
    open: openBrowserWebSocket,
    message: handleBrowserWebSocketMessage,
    close: closeBrowserWebSocket,
  },
});

// Start update checker
onUpdateChange((status) => {
  broadcast({ type: "update_status", ...status } as ServerMessage);
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
  startScheduledMessageScheduler();
})();

// Boot cronjob scheduler (loads configs, reconciles stale "running" rows, starts tick).
CronjobManager.startCronjobScheduler();

// Bring registered apps' tokens and units in line with their records. Never
// activates anything, and never fails the boot. See server/apps/boot.ts.
reconcileAppsAtBoot();

// Release quiet backend sessions; the next user message resumes from disk.
startIdleSessionEvictor();

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
