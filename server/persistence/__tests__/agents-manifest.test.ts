import { describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_CAPABILITIES } from "../../../shared/types.ts";
import { buildAgentsManifest } from "../config/agents.ts";

describe("buildAgentsManifest", () => {
  test("includes stable room and backend metadata for agent discovery", () => {
    const manifest = buildAgentsManifest([
      {
        id: "agent-1",
        name: "Reviewer",
        userId: "user-1",
        managerName: "Ada",
        privileged: true,
        desk: 3,
        room: 1,
        roomId: "room-side",
        roomName: "Side Projects",
        topic: "Reviewing a PR",
        cwd: "/work/project",
        agentType: "codex",
        capabilities: { ...DEFAULT_AGENT_CAPABILITIES, hooks: false, fork: false },
        modelFamily: "gpt-5.3-codex",
        model: "gpt-5.3-codex",
        effort: "high",
        permissionMode: "never",
        sandbox: "danger-full-access",
        inFlightTurn: { startedAt: 2000, activeTool: { startedAt: 2500 } },
        lastSessionId: "session-123",
      },
    ]);

    expect(manifest).toEqual([
      {
        id: "agent-1",
        name: "Reviewer",
        userId: "user-1",
        managerName: "Ada",
        privileged: true,
        desk: 3,
        room: 2,
        roomId: "room-side",
        roomName: "Side Projects",
        topic: "Reviewing a PR",
        cwd: "/work/project",
        agentType: "codex",
        capabilities: { ...DEFAULT_AGENT_CAPABILITIES, hooks: false, fork: false },
        modelFamily: "gpt-5.3-codex",
        model: "gpt-5.3-codex",
        effort: "high",
        permissionMode: "never",
        sandbox: "danger-full-access",
        inFlightTurn: { startedAt: 2000, activeTool: { startedAt: 2500 } },
        lastSessionId: "session-123",
        logDir: expect.stringContaining("/logs/agent-1"),
      },
    ]);
  });
});
