import type { AgentInfo, AgentOutfit, TaskItem, TaskPriority, RoomWire, OfficeSettings } from "./types.ts";
import type { OfficeEvent, OfficeStateData } from "./office-events.ts";
import type { RoomPet } from "./user-types.ts";
import { normalizeRoomPet } from "./user-types.ts";
import { generateRoomId } from "./types.ts";
import { createAgentInfo, firstOpenDesk, hasDuplicateAgentName, roomIndexById } from "./office-agents.ts";
import { closeRoomInList, createRoomInList, moveAgentToRoom, renameRoomInList } from "./office-rooms.ts";
import { addTaskToList, deleteTaskFromList, updateTaskInList } from "./office-tasks.ts";
import { isValidDesk } from "./desks.ts";
export type { OfficeEvent, OfficeStateData } from "./office-events.ts";

export class OfficeState {
  private agents = new Map<string, AgentInfo>();
  private _rooms: RoomWire[] = [{ id: generateRoomId(), name: "Room 1", prompt: null, envFile: null, pet: null }];
  private _office: OfficeSettings = { prompt: null, envFile: null, previewAllowHosts: [], experimental: { browserPanel: false } };
  private _tasks: TaskItem[] = [];
  private _recentCwds: string[] = [];

  get rooms() {
    return this._rooms;
  }
  get office() {
    return this._office;
  }
  get tasks() {
    return this._tasks;
  }
  get recentCwds() {
    return this._recentCwds;
  }

  getState(): OfficeStateData {
    return {
      agents: [...this.agents.values()],
      rooms: [...this._rooms],
      office: { ...this._office },
      tasks: [...this._tasks],
      recentCwds: [...this._recentCwds],
    };
  }

  getAgent(agentId: string): AgentInfo | undefined {
    return this.agents.get(agentId);
  }

  getAllAgents(): AgentInfo[] {
    return [...this.agents.values()];
  }

  // -- Initialization (for restoring persisted state) --

  addExistingAgent(agent: AgentInfo) {
    this.agents.set(agent.id, agent);
  }

  setRooms(rooms: RoomWire[]) {
    this._rooms = rooms.length > 0 ? rooms.map((room) => ({ ...room, pet: normalizeRoomPet(room.pet) })) : [{ id: generateRoomId(), name: "Room 1", prompt: null, envFile: null, pet: null }];
  }

  setOfficeDirect(office: OfficeSettings) {
    this._office = { ...office };
  }

  setTasksDirect(tasks: TaskItem[]) {
    this._tasks = tasks;
  }

  setRecentCwds(cwds: string[]) {
    this._recentCwds = cwds;
  }

  // -- Mutations (return OfficeEvent[]) --

  spawn(opts: {
    name: string;
    cwd: string;
    permissionMode: AgentInfo["permissionMode"];
    desk?: number;
    roomId?: string;
    customInstructions?: string;
  }): { agent: AgentInfo; events: OfficeEvent[] } | null {
    if (hasDuplicateAgentName(this.agents.values(), opts.name)) return null;

    const targetRoom = roomIndexById(this._rooms, opts.roomId);
    const desk = firstOpenDesk(this.agents.values(), targetRoom, opts.desk);
    if (desk === -1) return null; // room full

    const agent = createAgentInfo({
      name: opts.name,
      cwd: opts.cwd,
      desk,
      room: targetRoom,
      permissionMode: opts.permissionMode,
      customInstructions: opts.customInstructions,
    });

    this.agents.set(agent.id, agent);

    // Track cwd
    this.addRecentCwd(opts.cwd);

    return {
      agent,
      events: [{ type: "agent_added", agent }],
    };
  }

  kill(agentId: string): OfficeEvent[] {
    if (!this.agents.has(agentId)) return [];
    this.agents.delete(agentId);
    return [{ type: "agent_removed", agentId }];
  }

  editAgent(agentId: string, changes: { name?: string; cwd?: string; outfit?: AgentOutfit; customInstructions?: string; permissionMode?: AgentInfo["permissionMode"] }): OfficeEvent[] {
    const agent = this.agents.get(agentId);
    if (!agent) return [];

    const updated: Partial<AgentInfo> = {};

    if (changes.name && changes.name !== agent.name) {
      if (!hasDuplicateAgentName(this.agents.values(), changes.name, agentId)) {
        agent.name = changes.name;
        updated.name = changes.name;
      }
    }
    if (changes.cwd && changes.cwd !== agent.cwd) {
      agent.cwd = changes.cwd;
      updated.cwd = changes.cwd;
      this.addRecentCwd(changes.cwd);
    }
    if (changes.outfit) {
      agent.outfit = changes.outfit;
      updated.outfit = changes.outfit;
    }
    if (changes.customInstructions !== undefined && changes.customInstructions !== agent.customInstructions) {
      agent.customInstructions = changes.customInstructions || null;
      updated.customInstructions = agent.customInstructions;
    }
    if (changes.permissionMode && changes.permissionMode !== agent.permissionMode) {
      agent.permissionMode = changes.permissionMode;
      updated.permissionMode = changes.permissionMode;
    }

    if (Object.keys(updated).length === 0) return [];
    return [{ type: "agent_updated", agentId, changes: updated }];
  }

  updateAgent(agentId: string, changes: Partial<AgentInfo>): OfficeEvent[] {
    const agent = this.agents.get(agentId);
    if (!agent) return [];
    Object.assign(agent, changes);
    return [{ type: "agent_updated", agentId, changes }];
  }

  swapDesks(deskA: number, deskB: number, roomId: string): OfficeEvent[] {
    if (deskA === deskB || !isValidDesk(deskA) || !isValidDesk(deskB)) return [];
    const room = this._rooms.findIndex((r) => r.id === roomId);
    if (room < 0) return [];

    const allAgents = [...this.agents.values()];
    const agentA = allAgents.find((a) => a.desk === deskA && a.room === room);
    const agentB = allAgents.find((a) => a.desk === deskB && a.room === room);
    if (!agentA && !agentB) return [];

    const events: OfficeEvent[] = [];
    if (agentA) {
      agentA.desk = deskB;
      events.push({ type: "agent_updated", agentId: agentA.id, changes: { desk: deskB } });
    }
    if (agentB) {
      agentB.desk = deskA;
      events.push({ type: "agent_updated", agentId: agentB.id, changes: { desk: deskA } });
    }
    return events;
  }

  createRoom(name?: string): OfficeEvent[] {
    const result = createRoomInList(this._rooms, name);
    this._rooms = result.rooms;
    return result.events;
  }

  closeRoom(roomId: string): OfficeEvent[] {
    const result = closeRoomInList(this._rooms, this.agents.values(), roomId);
    this._rooms = result.rooms;
    return result.events;
  }

  renameRoom(roomId: string, name: string): OfficeEvent[] {
    const result = renameRoomInList(this._rooms, roomId, name);
    this._rooms = result.rooms;
    return result.events;
  }

  moveAgent(agentId: string, targetRoomId: string): OfficeEvent[] {
    const targetRoom = this._rooms.findIndex((r) => r.id === targetRoomId);
    return moveAgentToRoom(this.agents.values(), agentId, targetRoom);
  }

  setOfficeSettings(prompt: string | null, envFile: string | null): OfficeEvent[] {
    const normalizedPrompt = prompt && prompt.trim() ? prompt.trim() : null;
    this._office = { ...this._office, prompt: normalizedPrompt, envFile: envFile || null };
    return [
      {
        type: "office_settings_updated",
        prompt: this._office.prompt,
        envFile: this._office.envFile,
        experimental: this._office.experimental,
      },
    ];
  }

  setRoomSettings(roomId: string, prompt: string | null, envFile: string | null): OfficeEvent[] {
    const idx = this._rooms.findIndex((r) => r.id === roomId);
    if (idx < 0) return [];
    const normalizedPrompt = prompt && prompt.trim() ? prompt.trim() : null;
    this._rooms[idx] = { ...this._rooms[idx], prompt: normalizedPrompt, envFile: envFile || null };
    return [{ type: "room_settings_updated", roomId, prompt: normalizedPrompt, envFile: envFile || null }];
  }

  setRoomPet(roomId: string, pet: RoomPet | null): OfficeEvent[] {
    const idx = this._rooms.findIndex((r) => r.id === roomId);
    if (idx < 0) return [];
    const normalizedPet = normalizeRoomPet(pet);
    this._rooms[idx] = { ...this._rooms[idx], pet: normalizedPet };
    return [{ type: "room_pet_updated", roomId, pet: normalizedPet }];
  }

  setRoomSkin(roomId: string, skin: import("./room-skins.ts").RoomSkin | null): OfficeEvent[] {
    const idx = this._rooms.findIndex((r) => r.id === roomId);
    if (idx < 0) return [];
    const next = skin ?? null;
    this._rooms[idx] = { ...this._rooms[idx], skin: next };
    return [{ type: "room_skin_updated", roomId, skin: next }];
  }

  setTopic(agentId: string, topic: string): OfficeEvent[] {
    const agent = this.agents.get(agentId);
    if (!agent) return [];
    agent.topic = topic.slice(0, 80);
    agent.topicStale = false;
    return [{ type: "agent_updated", agentId, changes: { topic: agent.topic, topicStale: false } }];
  }

  resetTopic(agentId: string): OfficeEvent[] {
    const agent = this.agents.get(agentId);
    if (!agent) return [];
    agent.topic = null;
    agent.topicStale = false;
    return [{ type: "agent_updated", agentId, changes: { topic: null, topicStale: false } }];
  }

  addTask(title: string, createdBy: string, opts?: { description?: string; priority?: TaskPriority; assignee?: string }): OfficeEvent[] {
    const result = addTaskToList(this._tasks, title, createdBy, opts);
    this._tasks = result.tasks;
    return result.events;
  }

  updateTask(id: string, changes: Partial<Pick<TaskItem, "title" | "description" | "priority" | "status" | "assignee">>): OfficeEvent[] {
    const result = updateTaskInList(this._tasks, id, changes);
    this._tasks = result.tasks;
    return result.events;
  }

  deleteTask(id: string): OfficeEvent[] {
    const result = deleteTaskFromList(this._tasks, id);
    this._tasks = result.tasks;
    return result.events;
  }

  addRecentCwd(cwd: string) {
    if (!cwd) return;
    this._recentCwds = [cwd, ...this._recentCwds.filter((c) => c !== cwd)].slice(0, 20);
  }
}
