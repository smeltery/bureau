import { describe, expect, test } from "bun:test";
import { DEFAULT_AGENT_CAPABILITIES } from "../../../shared/types.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { inMultiStepFlow, pendingPromptOf } from "../pending-prompt.ts";

function agentWith(overrides: Partial<ReturnType<typeof createManagedAgent>> = {}) {
  const managed = createManagedAgent({
    info: {
      id: "agent-1",
      name: "Prompt Test",
      desk: 0,
      room: 0,
      cwd: process.cwd(),
      outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
      permissionMode: "default",
      modelFamily: "sonnet",
      agentType: "claude",
      capabilities: DEFAULT_AGENT_CAPABILITIES,
      state: "waiting_for_response",
      topic: null,
      topicStale: false,
      customInstructions: null,
      customInstructionsVersion: "e3b0c44298fc",
    },
    skillCwd: process.cwd(),
    slashCommands: [],
    skills: [],
  });
  return Object.assign(managed, overrides);
}

describe("pendingPromptOf", () => {
  test("returns null when no prompt flags are set", () => {
    expect(pendingPromptOf(agentWith({}))).toBe(null);
  });

  test("maps pending flags to prompt kinds in priority order", () => {
    expect(pendingPromptOf(agentWith({ pendingPermission: { approvalId: "a", toolName: "Bash" } }))).toBe("permission");
    expect(pendingPromptOf(agentWith({ queuedPermissions: [{ event: { kind: "approval_request", approvalId: "b", toolName: "Bash", input: {} }, session: null }] }))).toBe("permission");
    expect(pendingPromptOf(agentWith({ pendingResume: true }))).toBe("resume");
    expect(pendingPromptOf(agentWith({ pendingModelPick: true }))).toBe("model");
    expect(pendingPromptOf(agentWith({ pendingEffortPick: true }))).toBe("effort");
    expect(pendingPromptOf(agentWith({ pendingCronjobPick: true }))).toBe("cronjob");
  });

  test("inMultiStepFlow mirrors pendingPromptOf", () => {
    const managed = agentWith({ pendingModelPick: true });
    expect(inMultiStepFlow(managed)).toBe(true);
  });
});
