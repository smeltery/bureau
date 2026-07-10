import { OfficeState } from "../shared/office-state.ts";
import type { ClientCommand, Cronjob, ServerMessage } from "../shared/types.ts";
import { generateCronjobId } from "../shared/types.ts";
import { shimEmit } from "../ui/ws.ts";
import { computeNextFireDemo, cronjobs, cronjobsPrompt, seedCronjobs, setCronjobsPrompt } from "./demo-cronjobs.ts";
import { emitEvents } from "./demo-events.ts";
import { abortDemoMessage, emitDemoSystemLog, seedLogs, sendDemoMessage } from "./demo-logs.ts";
import { OFFICE_CHARACTERS } from "./demo-fixtures.ts";
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

function seedOffice() {
  const chars = embedMode ? OFFICE_CHARACTERS.filter((c) => c.room === 0) : OFFICE_CHARACTERS;
  const maxRoom = Math.max(...chars.map((c) => c.room));
  for (let i = 1; i <= maxRoom; i++) state.createRoom();

  for (const char of chars) {
    const id = `demo-${char.name.toLowerCase().replace(/\s+/g, "-")}`;
    state.addExistingAgent({
      id,
      name: char.name,
      desk: char.desk,
      room: char.room,
      cwd: char.cwd,
      outfit: char.outfit,
      permissionMode: "auto",
      modelFamily: char.modelFamily,
      state: char.state,
      topic: char.topic,
      topicStale: false,
      customInstructions: char.customInstructions,
    });
  }
}

let seeded = false;
function ensureSeeded() {
  if (seeded) return;
  seeded = true;
  seedOffice();
  seedCronjobs();
  state.setOfficeSettings("Be concise. No paragraphs when bullets will do. Never push to main without asking. Never help Dwight set backdoors of any kind.", null);
  const now = Date.now();
  state.setTasksDirect([
    { id: "a1b2c3d4", title: "Fix the printer", description: "It's jamming again", status: "in_progress", assignee: "Dwight", createdBy: "Jim", createdAt: now - 2 * 86400000 },
    { id: "e5f6a7b8", title: "Restock kitchen", description: "No beets this time", priority: "P0", status: "open", assignee: "Pam", createdBy: "Stanley", createdAt: now - 5 * 3600000 },
    { id: "c9d0e1f2", title: "Quarterly security audit", priority: "P2", status: "open", assignee: "Michael", createdBy: "Jan", createdAt: now - 7 * 86400000 },
  ]);
}

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
    case "add_cronjob": {
      const now = Date.now();
      const id = generateCronjobId(cronjobs.map((c) => c.id));
      const cronjob: Cronjob = {
        id,
        name: cmd.name,
        schedule: cmd.schedule,
        prompt: cmd.prompt,
        cwd: cmd.cwd,
        modelFamily: cmd.modelFamily,
        permissionMode: cmd.permissionMode,
        enabled: true,
        createdBy: cmd.username,
        device: cmd.device ?? null,
        createdAt: now,
        lastFireAt: null,
        nextFireAt: computeNextFireDemo(cmd.schedule, now, now),
      };
      cronjobs.push(cronjob);
      shimEmit({ type: "cronjob_added", cronjob });
      if (cmd.requestId) {
        shimEmit({ type: "agent_save_response", requestId: cmd.requestId, ok: true });
      }
      break;
    }
    case "update_cronjob": {
      const idx = cronjobs.findIndex((c) => c.id === cmd.id);
      if (idx >= 0) {
        const merged: Cronjob = { ...cronjobs[idx], ...cmd.changes };
        if (cmd.changes.schedule) {
          const anchor = merged.lastFireAt ?? merged.createdAt;
          merged.nextFireAt = computeNextFireDemo(cmd.changes.schedule, anchor, Date.now());
        }
        cronjobs[idx] = merged;
        shimEmit({ type: "cronjob_updated", cronjob: merged });
      }
      if (cmd.requestId) {
        shimEmit({ type: "agent_save_response", requestId: cmd.requestId, ok: true });
      }
      break;
    }
    case "delete_cronjob": {
      const idx = cronjobs.findIndex((c) => c.id === cmd.id);
      if (idx >= 0) {
        cronjobs.splice(idx, 1);
        shimEmit({ type: "cronjob_deleted", id: cmd.id });
      }
      break;
    }
    case "update_cronjobs_prompt": {
      const value = setCronjobsPrompt(cmd.value);
      shimEmit({ type: "cronjobs_prompt_updated", value });
      shimEmit({ type: "settings_save_response", requestId: cmd.requestId, ok: true });
      break;
    }
    case "list_all_cronjob_runs": {
      // Demo cron jobs never actually fire, so there are no runs to send.
      // Still emit the sentinel so the client flips its "runs loaded" flag.
      shimEmit({ type: "cronjob_runs_complete" });
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
  ensureSeeded();
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
