import { expect, spyOn, test } from "bun:test";
import { cronjobRunStreamId } from "../../../../shared/types.ts";
import { mintRunToken, revokeRunToken } from "../../../cronjobs/tokens.ts";
import { mintAgentToken, revokeAgentToken } from "../../../agents/tokens.ts";
import { OpenCodeBackendSession } from "../session.ts";
import { openCodeAuthorityBroker } from "../authority-broker.ts";
import type { OpenCodeSupervisor } from "../supervisor.ts";

test("desk and scheduled sessions bind their own registered token, never an environment bearer", () => {
  const runId = crypto.randomUUID();
  const agentId = crypto.randomUUID();
  const runToken = mintRunToken("job", runId, "creator");
  const agentToken = mintAgentToken(agentId, "manager");
  const bind = spyOn(openCodeAuthorityBroker, "bind").mockReturnValue({ handle: "handle", activate: () => "handle", deactivate() {}, unbind() {} });
  const supervisor = {} as OpenCodeSupervisor;
  try {
    for (const [id, token] of [
      [cronjobRunStreamId(runId), runToken],
      [agentId, agentToken],
    ] as const) {
      const session = new OpenCodeBackendSession(
        { agentId: id, cwd: "/tmp", modelFamily: "opencode/gpt-5-nano", effort: "high", permissionMode: "default", systemPrompt: "stable", env: { BUREAU_AGENT_TOKEN: "wrong-agent" } },
        "opencode/gpt-5-nano",
        supervisor,
      );
      expect(bind).toHaveBeenLastCalledWith(id, token);
      session.close();
    }
    revokeRunToken(runId);
    const session = new OpenCodeBackendSession(
      {
        agentId: cronjobRunStreamId(runId),
        cwd: "/tmp",
        modelFamily: "opencode/gpt-5-nano",
        effort: "high",
        permissionMode: "default",
        systemPrompt: "stable",
        env: { BUREAU_AGENT_TOKEN: "wrong-agent" },
      },
      "opencode/gpt-5-nano",
      supervisor,
    );
    expect(bind).toHaveBeenCalledTimes(2);
    session.close();
  } finally {
    bind.mockRestore();
    revokeRunToken(runId);
    revokeAgentToken(agentId);
  }
});
