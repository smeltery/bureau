import { OfficeState, type OfficeEvent } from "../shared/office-state.ts";
import type { ClientCommand, ServerMessage, LogEntry, Cronjob, PresenceInfo, Schedule, SessionContext, SessionWire, UserRecord } from "../shared/types.ts";
import { generateCronjobId } from "../shared/types.ts";
import { defaultGhostColorForUserId, isGhostVariant, isHexColor, normalizeHexColor } from "../shared/avatar.ts";
import { shimEmit } from "../ui/ws.ts";
import { DEMO_CRONJOBS_SEED, DEMO_LOGS, OFFICE_CHARACTERS } from "./demo-fixtures.ts";

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

function seedLogs() {
  const baseTime = Date.now() - 120_000; // start 2 minutes ago
  for (const { agentName, entries } of DEMO_LOGS) {
    const char = OFFICE_CHARACTERS.find((c) => c.name === agentName);
    if (!char) continue;
    const agentId = `demo-${char.name.toLowerCase().replace(/\s+/g, "-")}`;
    let t = baseTime;
    for (const { kind, content, metadata } of entries) {
      t += 3000 + Math.random() * 5000;
      const meta = kind === "user_message" ? { ...metadata, username: "Ricky" } : metadata;
      const entry = makeLogEntry(agentId, kind, content, meta);
      entry.timestamp = t;
      shimEmit({ type: "log_entry", entry });
    }
  }
}

const DEMO_REPLY =
  "This is a demo — your message was not actually sent to Claude. To use Bureau for real, follow the setup instructions in the [README](https://github.com/dotbrains/bureau).";

// Cron jobs: maintained as plain in-memory state (not via OfficeState).
const cronjobs: Cronjob[] = [];
let cronjobsPrompt: string | null = null;
const users = new Map<string, UserRecord>();
let sessionContext: SessionContext | null = null;
let activeSessions: SessionWire[] = [];
let demoPresenceAgentIndex = 0;
let demoPresenceTimer: ReturnType<typeof setInterval> | null = null;
let currentDemoPresence: PresenceInfo | null = null;

function emitDemoPresence(currentRoom: number | null, focusedAgentId: string | null, viewMode: "office" | "log" | "away", device: string | null = null) {
  const entries: PresenceInfo[] = [];
  if (sessionContext) {
    const me = [...users.values()].find((u) => u.id === sessionContext?.userId);
    if (me) {
      currentDemoPresence = { connectionId: sessionContext.connectionId, userId: me.id, username: me.name, device, avatarColor: me.avatarColor, avatarVariant: me.avatarVariant, currentRoom, focusedAgentId, viewMode };
      entries.push(currentDemoPresence);
    }
  } else {
    currentDemoPresence = null;
  }
  const stephenPresence = getStephenPhonePresence();
  if (stephenPresence) entries.push(stephenPresence);
  shimEmit({ type: "presence_list", entries, totalOnlineUsers: countDemoOnlineUsers(entries) });
}

function getStephenPhonePresence(): PresenceInfo | null {
  const stephen = users.get("stephen");
  const roomZeroAgents = state.getState().agents.filter((a) => a.room === 0);
  const stephenAgent = roomZeroAgents[demoPresenceAgentIndex % Math.max(1, roomZeroAgents.length)];
  if (!stephen || !stephenAgent) return null;
  return { connectionId: "demo-stephen-phone", userId: stephen.id, username: stephen.name, device: "Phone", avatarColor: stephen.avatarColor, avatarVariant: stephen.avatarVariant, currentRoom: 0, focusedAgentId: stephenAgent.id, viewMode: "log" };
}

function emitCurrentDemoPresence() {
  const entries: PresenceInfo[] = [];
  if (currentDemoPresence) entries.push(currentDemoPresence);
  const stephenPresence = getStephenPhonePresence();
  if (stephenPresence) entries.push(stephenPresence);
  shimEmit({ type: "presence_list", entries, totalOnlineUsers: countDemoOnlineUsers(entries) });
}

function countDemoOnlineUsers(entries: PresenceInfo[]): number {
  return new Set(entries.map((entry) => entry.userId)).size;
}

function startDemoPresenceCycle() {
  if (demoPresenceTimer) return;
  demoPresenceTimer = setInterval(() => {
    const roomZeroAgents = state.getState().agents.filter((a) => a.room === 0);
    if (roomZeroAgents.length === 0) return;
    demoPresenceAgentIndex = (demoPresenceAgentIndex + 1) % roomZeroAgents.length;
    emitCurrentDemoPresence();
  }, 4000);
}

function seedUsers() {
  if (users.size > 0) return;
  const roomIds = state.getState().rooms.map((r) => r.id);
  const now = Date.now();
  const ricky: UserRecord = { id: "demo-ricky", name: "Ricky", role: "owner", allowedRooms: roomIds, defaultRoomId: roomIds[0] ?? null, avatarColor: defaultGhostColorForUserId("demo-ricky"), avatarVariant: "classic", createdAt: now - 7 * 86400000 };
  const stephen: UserRecord = { id: "demo-stephen", name: "Stephen", role: "member", allowedRooms: roomIds.slice(0, 1), defaultRoomId: roomIds[0] ?? null, avatarColor: defaultGhostColorForUserId("demo-stephen"), avatarVariant: "stubby-arms", createdAt: now - 5 * 86400000 };
  users.set("ricky", ricky);
  users.set("stephen", stephen);
  sessionContext = { userId: ricky.id, username: ricky.name, role: ricky.role, currentSessionPrefix: "a1b2c3d4", connectionId: "a1b2c3d4" };
  activeSessions = [
    { sessionPrefix: "a1b2c3d4", username: "Ricky", createdAt: now - 7 * 86400000, lastSeenAt: now - 30_000, expiresAt: now + 30 * 86400000, absoluteExpiresAt: now + 365 * 86400000 },
    { sessionPrefix: "7e9f0a12", username: "Ricky", createdAt: now - 3 * 86400000, lastSeenAt: now - 2 * 3600000, expiresAt: now + 30 * 86400000, absoluteExpiresAt: now + 365 * 86400000 },
    { sessionPrefix: "9f8e7d6c", username: "Stephen", createdAt: now - 5 * 86400000, lastSeenAt: now - 15 * 60_000, expiresAt: now + 30 * 86400000, absoluteExpiresAt: now + 365 * 86400000 },
  ];
}

function computeNextFireDemo(schedule: Schedule, anchor: number, now: number = Date.now()): number {
  if (schedule.type === "interval") {
    const intervalMs = Math.max(5, schedule.minutes) * 60_000;
    if (now <= anchor) return anchor + intervalMs;
    const periods = Math.floor((now - anchor) / intervalMs) + 1;
    return anchor + periods * intervalMs;
  }
  const next = new Date(now);
  next.setSeconds(0, 0);
  next.setHours(schedule.hour, schedule.minute, 0, 0);
  if (schedule.type === "daily") {
    if (next.getTime() <= now) next.setDate(next.getDate() + 1);
    return next.getTime();
  }
  // weekly
  const currentDay = next.getDay();
  let daysAhead = (schedule.weekday - currentDay + 7) % 7;
  if (daysAhead === 0 && next.getTime() <= now) daysAhead = 7;
  next.setDate(next.getDate() + daysAhead);
  return next.getTime();
}

function seedCronjobs() {
  const now = Date.now();
  const usedIds = new Set<string>();
  for (const seed of DEMO_CRONJOBS_SEED) {
    const id = generateCronjobId(Array.from(usedIds));
    usedIds.add(id);
    const createdAt = now - seed.ageDays * 86400000;
    const lastFireAt = seed.lastFireDaysAgo === null ? null : now - seed.lastFireDaysAgo * 86400000;
    cronjobs.push({
      id,
      name: seed.name,
      schedule: seed.schedule,
      prompt: seed.prompt,
      cwd: seed.cwd,
      modelFamily: seed.modelFamily,
      permissionMode: "bypassPermissions",
      enabled: true,
      createdBy: seed.createdBy,
      device: null,
      createdAt,
      lastFireAt,
      nextFireAt: computeNextFireDemo(seed.schedule, lastFireAt ?? createdAt, now),
    });
  }
}

// Track pending reply timeouts per agent to avoid flickering on rapid sends
const pendingReplies = new Map<string, ReturnType<typeof setTimeout>>();

function emitEvents(events: OfficeEvent[]) {
  for (const event of events) {
    switch (event.type) {
      case "agent_added":
        shimEmit({ type: "agent_added", agent: event.agent });
        // Send empty slash_commands so autocomplete initializes
        shimEmit({ type: "slash_commands", agentId: event.agent.id, commands: [], skills: [] });
        break;
      case "agent_removed":
        shimEmit({ type: "agent_removed", agentId: event.agentId });
        break;
      case "agent_updated":
        shimEmit({ type: "agent_updated", agentId: event.agentId, changes: event.changes });
        break;
      case "room_created":
        shimEmit({ type: "room_created", room: event.room });
        break;
      case "room_renamed":
        shimEmit({ type: "room_renamed", roomId: event.roomId, name: event.name });
        break;
      case "room_closed":
        shimEmit({ type: "room_closed", roomId: event.roomId });
        break;
      case "room_settings_updated":
        shimEmit({ type: "room_settings_updated", roomId: event.roomId, prompt: event.prompt, envFile: event.envFile });
        break;
      case "office_settings_updated":
        shimEmit({ type: "office_settings_updated", prompt: event.prompt, envFile: event.envFile });
        break;
      case "tasks_changed":
        shimEmit({ type: "tasks", tasks: event.tasks });
        break;
    }
  }
}

function makeLogEntry(agentId: string, kind: LogEntry["kind"], content: string, metadata?: Record<string, unknown>): LogEntry {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agentId,
    timestamp: Date.now(),
    kind,
    content,
    metadata,
  };
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
        // System message
        const entry = makeLogEntry(result.agent.id, "system", `Agent "${cmd.name}" ready. Working in ${cmd.cwd}. (Demo mode)`);
        shimEmit({ type: "log_entry", entry });
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
      const user = users.get(cmd.username.trim().toLocaleLowerCase());
      if (user) sessionContext = { userId: user.id, username: user.name, role: user.role, currentSessionPrefix: user.name === "Ricky" ? "a1b2c3d4" : "9f8e7d6c", connectionId: user.name === "Ricky" ? "a1b2c3d4" : "9f8e7d6c" };
      shimEmit({ type: "session_context", context: sessionContext });
      shimEmit({ type: "users_list", users: [...users.values()] });
      break;
    }
    case "update_user": {
      const existing = [...users.values()].find((u) => u.id === cmd.userId);
      let updated: UserRecord | null = null;
      if (existing) {
        const next: UserRecord = {
          ...existing,
          name: cmd.changes.name?.trim() || existing.name,
          role: cmd.changes.role ?? existing.role,
          allowedRooms: cmd.changes.allowedRooms ?? existing.allowedRooms,
          defaultRoomId: cmd.changes.defaultRoomId === undefined ? existing.defaultRoomId : cmd.changes.defaultRoomId,
          avatarColor: cmd.changes.avatarColor && isHexColor(cmd.changes.avatarColor) ? normalizeHexColor(cmd.changes.avatarColor) : existing.avatarColor,
          avatarVariant: cmd.changes.avatarVariant && isGhostVariant(cmd.changes.avatarVariant) ? cmd.changes.avatarVariant : existing.avatarVariant,
        };
        users.delete(existing.name.toLocaleLowerCase());
        users.set(next.name.toLocaleLowerCase(), next);
        updated = next;
      }
      shimEmit({ type: "users_list", users: [...users.values()] });
      if (updated?.name === "Stephen") emitCurrentDemoPresence();
      break;
    }
    case "delete_user": {
      const existing = [...users.values()].find((u) => u.id === cmd.userId);
      if (existing) users.delete(existing.name.toLocaleLowerCase());
      shimEmit({ type: "users_list", users: [...users.values()] });
      break;
    }
    case "list_active_sessions":
      shimEmit({ type: "sessions_active_list", sessions: [...activeSessions] });
      break;
    case "revoke_session":
      activeSessions = activeSessions.filter((s) => s.sessionPrefix !== cmd.sessionPrefix);
      shimEmit({ type: "sessions_active_list", sessions: [...activeSessions] });
      break;
    case "logout":
      sessionContext = null;
      shimEmit({ type: "session_context", context: null });
      emitDemoPresence(null, null, "away");
      break;
    case "presence_update":
      emitDemoPresence(cmd.currentRoom, cmd.focusedAgentId, cmd.viewMode, cmd.device ?? null);
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
      // Log the user message
      const userEntry = makeLogEntry(cmd.agentId, "user_message", cmd.text, cmd.username ? { username: cmd.username } : undefined);
      shimEmit({ type: "log_entry", entry: userEntry });
      // Cancel any pending reply for this agent (prevents flickering on rapid sends)
      const prev = pendingReplies.get(cmd.agentId);
      if (prev) clearTimeout(prev);
      // Briefly show "thinking" state, then reply
      shimEmit({ type: "agent_updated", agentId: cmd.agentId, changes: { state: "thinking" } });
      pendingReplies.set(cmd.agentId, setTimeout(() => {
        pendingReplies.delete(cmd.agentId);
        const replyEntry = makeLogEntry(cmd.agentId, "text", DEMO_REPLY);
        shimEmit({ type: "log_entry", entry: replyEntry });
        shimEmit({ type: "agent_updated", agentId: cmd.agentId, changes: { state: "waiting_for_response" } });
      }, 800));
      break;
    }
    case "abort": {
      // Cancel any pending reply
      const pendingAbort = pendingReplies.get(cmd.agentId);
      if (pendingAbort) {
        clearTimeout(pendingAbort);
        pendingReplies.delete(cmd.agentId);
      }
      shimEmit({ type: "agent_updated", agentId: cmd.agentId, changes: { state: "waiting_for_response" } });
      const abortEntry = makeLogEntry(cmd.agentId, "system", "Agent interrupted.");
      shimEmit({ type: "log_entry", entry: abortEntry });
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
      cronjobsPrompt = cmd.value && cmd.value.trim() ? cmd.value : null;
      shimEmit({ type: "cronjobs_prompt_updated", value: cronjobsPrompt });
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
  seedUsers();
  const s = state.getState();
  shimEmit({ type: "full_state", agents: s.agents, recentCwds: s.recentCwds, office: s.office, rooms: s.rooms, allRooms: s.rooms, killedAgents: [] });
  shimEmit({ type: "tasks", tasks: s.tasks });
  shimEmit({ type: "cronjobs_state", cronjobs: [...cronjobs], cronjobsPrompt });
  shimEmit({ type: "users_list", users: [...users.values()] });
  shimEmit({ type: "session_context", context: sessionContext });
  emitDemoPresence(0, null, "office");
  startDemoPresenceCycle();
  seedLogs();
}
