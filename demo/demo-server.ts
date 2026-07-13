import { OfficeState } from "../shared/office-state.ts";
import type { ClientCommand } from "../shared/types.ts";
import { shimEmit } from "../ui/ws.ts";
import { cronjobs, cronjobsPrompt } from "./demo-cronjobs.ts";
import { handleDemoCronjobCommand } from "./demo-cronjob-commands.ts";
import { emitEvents } from "./demo-events.ts";
import { abortDemoMessage, emitDemoSystemLog, seedLogs, sendDemoMessage } from "./demo-logs.ts";
import { ensureDemoSeeded } from "./demo-seed.ts";
import {
  claimDemoUser,
  deleteDemoUser,
  demoSessionContext,
  demoUsers,
  emitDemoPresence,
  listDemoActiveSessions,
  logoutDemoSession,
  revokeDemoSession,
  seedUsers,
  startDemoPresenceCycle,
  updateDemoUser,
} from "./demo-users.ts";

const state = new OfficeState();
let embedMode = false;

export function setEmbedMode() { embedMode = true; }

export function handleCommand(cmd: ClientCommand) {
  switch (cmd.type) {
    case "spawn": {
      const result = state.spawn({
        name: cmd.name,
        cwd: cmd.cwd,
        permissionMode: cmd.permissionMode,
        desk: cmd.desk,
        roomId: cmd.roomId,
        customInstructions: cmd.customInstructions,
      });
      if (result) {
        emitEvents(result.events);
        emitDemoSystemLog(result.agent.id, `Agent "${cmd.name}" ready. Working in ${cmd.cwd}. (Demo mode)`);
      }
      if (cmd.requestId) {
        shimEmit({ type: "agent_save_response", requestId: cmd.requestId, ok: true });
      }
      break;
    }
    case "kill": {
      emitEvents(state.kill(cmd.agentId));
      break;
    }
    case "revive": {
      // The demo never populates killedAgents, so the chip never renders and
      // this is unreachable in practice. The stub keeps the ClientCommand
      // union type-covered and reports a clean failure on hand-crafted commands.
      if (cmd.requestId) {
        shimEmit({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: "Revive is not available in the demo." });
      }
      break;
    }
    case "edit_agent": {
      emitEvents(state.editAgent(cmd.agentId, {
        name: cmd.name,
        cwd: cmd.cwd,
        outfit: cmd.outfit,
        customInstructions: cmd.customInstructions,
        permissionMode: cmd.permissionMode,
      }));
      if (cmd.requestId) {
        shimEmit({ type: "agent_save_response", requestId: cmd.requestId, ok: true });
      }
      break;
    }
    case "swap_desks": {
      emitEvents(state.swapDesks(cmd.deskA, cmd.deskB, cmd.roomId));
      break;
    }
    case "create_room": {
      emitEvents(state.createRoom(cmd.name));
      break;
    }
    case "close_room": {
      emitEvents(state.closeRoom(cmd.roomId));
      break;
    }
    case "rename_room": {
      emitEvents(state.renameRoom(cmd.roomId, cmd.name));
      break;
    }
    case "move_agent": {
      emitEvents(state.moveAgent(cmd.agentId, cmd.targetRoomId));
      break;
    }
    case "set_topic": {
      emitEvents(state.setTopic(cmd.agentId, cmd.topic));
      break;
    }
    case "reset_topic": {
      emitEvents(state.resetTopic(cmd.agentId));
      break;
    }
    case "update_office_settings": {
      const envFile = cmd.envFile && cmd.envFile.trim() ? cmd.envFile.trim() : null;
      emitEvents(state.setOfficeSettings(cmd.prompt, envFile));
      shimEmit({ type: "settings_save_response", requestId: cmd.requestId, ok: true });
      break;
    }
    case "update_room_settings": {
      const envFile = cmd.envFile && cmd.envFile.trim() ? cmd.envFile.trim() : null;
      emitEvents(state.setRoomSettings(cmd.roomId, cmd.prompt, envFile));
      shimEmit({ type: "settings_save_response", requestId: cmd.requestId, ok: true });
      break;
    }
    case "request_cwd_validation": {
      // Demo mode: assume all paths are valid (no filesystem access).
      shimEmit({ type: "cwd_validation", requestId: cmd.requestId, ok: true });
      break;
    }
    case "request_settings_validation": {
      const s = state.getState();
      if (cmd.scope === "office") {
        shimEmit({ type: "settings_validation", requestId: cmd.requestId, scope: "office", envFile: s.office.envFile, ok: true });
      } else if (cmd.roomId) {
        const room = s.rooms.find((r) => r.id === cmd.roomId);
        shimEmit({ type: "settings_validation", requestId: cmd.requestId, scope: "room", roomId: cmd.roomId, envFile: room?.envFile ?? null, ok: true });
      }
      break;
    }
    case "claim_user": {
      claimDemoUser(cmd.username);
      break;
    }
    case "update_user": {
      updateDemoUser(state, cmd.userId, cmd.changes);
      break;
    }
    case "delete_user": {
      deleteDemoUser(cmd.userId);
      break;
    }
    case "list_active_sessions":
      listDemoActiveSessions();
      break;
    case "revoke_session":
      revokeDemoSession(cmd.sessionPrefix);
      break;
    case "logout":
      logoutDemoSession(state);
      break;
    case "presence_update":
      emitDemoPresence(state, cmd.currentRoom, cmd.focusedAgentId, cmd.viewMode, cmd.device ?? null);
      break;
    case "add_task": {
      emitEvents(state.addTask(cmd.title, cmd.username, { description: cmd.description, priority: cmd.priority, assignee: cmd.assignee }));
      break;
    }
    case "update_task": {
      emitEvents(state.updateTask(cmd.id, cmd.changes));
      break;
    }
    case "delete_task": {
      emitEvents(state.deleteTask(cmd.id));
      break;
    }
    case "send_message": {
      sendDemoMessage(cmd.agentId, cmd.text, cmd.username);
      break;
    }
    case "abort": {
      abortDemoMessage(cmd.agentId);
      break;
    }
    case "add_cronjob":
    case "update_cronjob":
    case "delete_cronjob":
    case "update_cronjobs_prompt":
    case "list_all_cronjob_runs": {
      handleDemoCronjobCommand(cmd);
      break;
    }
    // Silent no-ops
    case "terminal_open":
    case "terminal_input":
    case "terminal_resize":
    case "terminal_close":
    case "new_conversation":
    case "resume":
    case "list_sessions":
    case "run_cronjob_now":
    case "list_cronjob_runs":
    case "load_cronjob_run":
    case "send_cronjob_run_message":
    case "edit_cronjob_run_message":
      break;
  }
}

export function sendInitialState() {
  ensureDemoSeeded(state, embedMode);
  seedUsers(state);
  const s = state.getState();
  shimEmit({ type: "full_state", agents: s.agents, recentCwds: s.recentCwds, office: s.office, rooms: s.rooms, allRooms: s.rooms, killedAgents: [] });
  shimEmit({ type: "tasks", tasks: s.tasks });
  shimEmit({ type: "cronjobs_state", cronjobs: [...cronjobs], cronjobsPrompt });
  shimEmit({ type: "users_list", users: demoUsers() });
  shimEmit({ type: "session_context", context: demoSessionContext() });
  emitDemoPresence(state, 0, null, "office");
  startDemoPresenceCycle(state);
  seedLogs();
}
