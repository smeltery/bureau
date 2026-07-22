import { describe, expect, test } from "bun:test";
import type { AgentInfo } from "../../../shared/types.ts";
import { buildPlainText, countBusyAgents } from "./UpdateModal.tsx";

function agent(state: AgentInfo["state"]): Pick<AgentInfo, "state"> {
  return { state };
}

describe("UpdateModal helpers", () => {
  test("counts only agents that would be interrupted mid-turn", () => {
    expect(countBusyAgents([agent("idle"), agent("thinking"), agent("tool_executing"), agent("waiting_for_response"), agent("error")])).toBe(2);
  });

  test("includes busy-agent restart warning in copied update text", () => {
    const text = buildPlainText({ sha: "1234567890", message: "current", date: "2026-07-20T12:00:00Z" }, { sha: "abcdef1234", message: "latest", date: "2026-07-21T12:00:00Z" }, 2);

    expect(text).toContain("Warning: 2 agents are currently working.");
    expect(text).toContain("Wait for them to finish before restarting");
  });

  test("omits restart warning when no agents are busy", () => {
    const text = buildPlainText({ sha: "1234567890", message: "current", date: "2026-07-20T12:00:00Z" }, { sha: "abcdef1234", message: "latest", date: "2026-07-21T12:00:00Z" }, 0);

    expect(text).not.toContain("Warning:");
  });
});
