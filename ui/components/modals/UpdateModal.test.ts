import { describe, expect, test } from "bun:test";
import type { AgentInfo } from "../../../shared/types.ts";
import type { CommitNotice } from "../../../shared/update-notice.ts";
import { buildPlainText, countBusyAgents } from "./UpdateModal.tsx";

function agent(state: AgentInfo["state"]): Pick<AgentInfo, "state"> {
  return { state };
}

describe("UpdateModal helpers", () => {
  const notice: CommitNotice = {
    pill: "new release",
    title: "New Release Available",
    notice: "You're on v2026.7.20; v2026.7.24 is out.",
  };

  test("counts only agents that would be interrupted mid-turn", () => {
    expect(countBusyAgents([agent("idle"), agent("thinking"), agent("tool_executing"), agent("waiting_for_response"), agent("error")])).toBe(2);
  });

  test("includes busy-agent restart warning in copied update text", () => {
    const text = buildPlainText(notice, 2);

    expect(text).toContain("Warning: 2 agents are currently working.");
    expect(text).toContain("Wait for them to finish before restarting");
  });

  test("omits restart warning when no agents are busy", () => {
    const text = buildPlainText(notice, 0);

    expect(text).not.toContain("Warning:");
  });

  test("includes user and system service restart commands", () => {
    const text = buildPlainText(notice, 0);

    expect(text).toContain("systemctl --user restart bureau");
    expect(text).toContain("sudo systemctl restart bureau");
  });
});
