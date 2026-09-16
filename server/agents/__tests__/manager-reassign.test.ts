import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { editAgent, reassignAgentsOwnedBy } from "../settings.ts";
import { agents } from "../state.ts";
import { loadAgentHistory, saveAgentHistory } from "../../persistence/config/agent-history.ts";
import { claimUserByName, deleteUserById, firstOfficeOwner } from "../../users.ts";

function installAgent(id: string, userId: string | null) {
  const info: AgentInfo = {
    id,
    name: id,
    userId,
    desk: 0,
    room: 0,
    roomId: "room-1",
    cwd: process.cwd(),
    outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: null,
    queue: [],
  };
  agents.set(id, createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] }));
}

const createdUserIds: string[] = [];

afterEach(() => {
  agents.clear();
  for (const id of createdUserIds.splice(0)) deleteUserById(id);
});

function seedOwner(label: string) {
  const user = claimUserByName(`${label}-${crypto.randomUUID()}`, { role: "owner" });
  createdUserIds.push(user.id);
  return user;
}

describe("manager reassignment", () => {
  test("editAgent updates userId on the live agent", async () => {
    const owner = seedOwner("Owner");
    const member = seedOwner("Member");
    installAgent("agent-1", owner.id);

    await editAgent("agent-1", { userId: member.id });

    expect(agents.get("agent-1")?.info.userId).toBe(member.id);
  });

  test("reassignAgentsOwnedBy moves live agents and killed history to the successor", async () => {
    const ownerA = seedOwner("OwnerA");
    const ownerB = seedOwner("OwnerB");
    installAgent("live-1", ownerA.id);
    const history = loadAgentHistory();
    history["killed-1"] = {
      name: "Killed",
      userId: ownerA.id,
      lastRoomId: "room-1",
      lastRoomName: "Room",
      killedAt: Date.now(),
    };
    saveAgentHistory(history);

    const count = await reassignAgentsOwnedBy(ownerA.id, ownerB.id);

    expect(count).toBe(1);
    expect(agents.get("live-1")?.info.userId).toBe(ownerB.id);
    expect(loadAgentHistory()["killed-1"]?.userId).toBe(ownerB.id);
  });

  test("firstOfficeOwner skips the excluded user", () => {
    const a = seedOwner("Alpha");
    const b = seedOwner("Beta");
    expect(firstOfficeOwner(a.id)?.id).not.toBe(a.id);
    expect(firstOfficeOwner(b.id)?.id).not.toBe(b.id);
  });
});
