import { afterEach, describe, expect, test } from "bun:test";

import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo, type UserRecord } from "../../../shared/types.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { agents, setRooms } from "../state.ts";
import { renderUsageReport, usageAudienceForUser } from "../usage/report.ts";

const ROOM_A = { id: "room-a", name: "Room A", prompt: null, envFile: null };
const ROOM_B = { id: "room-b", name: "Room B", prompt: null, envFile: null };

afterEach(() => {
  agents.clear();
  setRooms([{ id: "room-default", name: "Room 1", prompt: null, envFile: null }]);
});

function user(role: UserRecord["role"], allowedRooms: string[]): UserRecord {
  return {
    id: "user-1",
    name: "User",
    role,
    allowedRooms,
    notifRooms: [],
    envFile: null,
    language: null,
    createdAt: 0,
    avatarColor: "#000000",
    avatarVariant: "classic",
    hidden: [],
    order: [],
    defaultRoomId: null,
    memberPrompt: null,
  };
}

function installAgent(id: string, name: string, room: number) {
  const info: AgentInfo = {
    id,
    name,
    desk: room,
    room,
    roomId: room === 0 ? ROOM_A.id : ROOM_B.id,
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
    effort: "high",
  };
  agents.set(id, createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] }));
}

describe("usageAudienceForUser", () => {
  test("owners see the office and members see only their room grants", () => {
    expect(usageAudienceForUser(user("owner", [])).kind).toBe("owner");
    const audience = usageAudienceForUser(user("member", [ROOM_A.id]));
    expect(audience.kind).toBe("member");
    expect(audience.kind === "member" && [...audience.roomIds]).toEqual([ROOM_A.id]);
  });

  test("missing users fail closed", () => {
    const audience = usageAudienceForUser(null);
    expect(audience.kind).toBe("member");
    expect(audience.kind === "member" && audience.roomIds.size).toBe(0);
  });
});

describe("renderUsageReport access scoping", () => {
  test("filters agent and room rows to member-visible rooms", () => {
    setRooms([ROOM_A, ROOM_B]);
    installAgent("agent-a", "Alpha", 0);
    installAgent("agent-b", "Beta", 1);

    const report = renderUsageReport(usageAudienceForUser(user("member", [ROOM_A.id])));

    expect(report).toContain("| Alpha | Room A |");
    expect(report).toContain("| Room A |");
    expect(report).toContain("| **Total** |");
    expect(report).not.toContain("Beta");
    expect(report).not.toContain("Room B");
    expect(report).not.toContain("Office total");
  });
});
