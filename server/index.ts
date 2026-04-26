import type { ClientCommand, ServerMessage } from "../shared/types.ts";
import * as AgentManager from "./agent-manager.ts";
import * as CronjobManager from "./cronjobs/index.ts";
import { loadRecentCwds } from "./persistence.ts";
import { getUpdateStatus, onUpdateChange, startUpdateChecker } from "./update-checker.ts";
import { broadcast, browsers, tasks } from "./ws/broadcast.ts";
import { handleCommand } from "./ws/commands.ts";
import { handleLiveReloadRequest, startLiveReloadWatcher } from "./http/live-reload.ts";
import { handleTasksRequest } from "./http/tasks.ts";
import { handleCronjobsRequest } from "./http/cronjobs.ts";
import { handleFilesRequest } from "./http/files.ts";
import { handleStaticRequest } from "./http/static.ts";

// Wire AgentManager events to WebSocket broadcasts
AgentManager.onEvent((event) => {
  broadcast(event as ServerMessage);
});

// Wire CronjobManager events to WebSocket broadcasts
CronjobManager.onCronjobEvent((event) => {
  broadcast(event as ServerMessage);
});

// Start the live-reload filesystem watcher (no-op unless BUREAU_LIVE_RELOAD=1)
startLiveReloadWatcher();

const PORT = parseInt(process.env.PORT || "4000");

const server = Bun.serve({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);

    // WebSocket upgrade
    if (url.pathname === "/ws") {
      if (server.upgrade(req)) return;
      return new Response("WebSocket upgrade failed", { status: 400 });
    }

    // Live-reload SSE
    const liveReload = handleLiveReloadRequest(req, url);
    if (liveReload) return liveReload;

    // Task HTTP API
    const tasksResp = await handleTasksRequest(req, url);
    if (tasksResp) return tasksResp;

    // Cronjobs HTTP API (read-only — mutations go through WebSocket)
    const cronjobsResp = await handleCronjobsRequest(req, url);
    if (cronjobsResp) return cronjobsResp;

    // File upload + file/image serving
    const filesResp = await handleFilesRequest(req, url);
    if (filesResp) return filesResp;

    // Demo + UI SPA fallback
    return handleStaticRequest(req, url);
  },
  websocket: {
    open(ws) {
      browsers.add(ws);
      // Send current agent list
      const agents = AgentManager.getAllAgents();
      const recentCwds = loadRecentCwds();
      ws.send(JSON.stringify({ type: "full_state", agents, recentCwds, office: AgentManager.getOfficeSettings(), rooms: AgentManager.getRooms() } as ServerMessage));
      // Send tasks
      ws.send(JSON.stringify({ type: "tasks", tasks } as ServerMessage));
      // Send cronjobs + cronjobsPrompt
      ws.send(
        JSON.stringify({
          type: "cronjobs_state",
          cronjobs: CronjobManager.listCronjobs(),
          cronjobsPrompt: CronjobManager.getCronjobsPrompt(),
        } as ServerMessage),
      );
      // Send update status
      const update = getUpdateStatus();
      if (update.updateAvailable) {
        ws.send(JSON.stringify({ type: "update_status", updateAvailable: true, current: update.current, latest: update.latest } as ServerMessage));
      }
      // Send cached log history and slash commands for each agent
      for (const agent of agents) {
        const logs = AgentManager.getAgentLogs(agent.id);
        for (const entry of logs) {
          ws.send(JSON.stringify({ type: "log_entry", entry } as ServerMessage));
        }
        const cmds = AgentManager.getAgentCommands(agent.id);
        if (cmds.commands.length > 0 || cmds.skills.length > 0) {
          ws.send(
            JSON.stringify({
              type: "slash_commands",
              agentId: agent.id,
              commands: cmds.commands,
              skills: cmds.skills,
            } as ServerMessage),
          );
        }
      }
    },
    message(ws, data) {
      try {
        const cmd = JSON.parse(data as string) as ClientCommand;
        handleCommand(cmd, ws);
      } catch (e) {
        console.error("Invalid command:", e);
      }
    },
    close(ws) {
      browsers.delete(ws);
    },
  },
});

// Start update checker
onUpdateChange((status) => {
  broadcast({ type: "update_status", updateAvailable: status.updateAvailable, current: status.current, latest: status.latest } as ServerMessage);
});
startUpdateChecker();

// Restore persisted agents on startup
AgentManager.restoreAgents().then((restored) => {
  if (restored.length > 0) {
    console.log(`Restored ${restored.length} agent(s): ${restored.map((a) => a.name).join(", ")}`);
  }
});

// Boot cronjob scheduler (loads configs, reconciles stale "running" rows, starts tick).
CronjobManager.startCronjobScheduler();

console.log(`Bureau running at http://localhost:${server.port}`);
