import { expect, test } from "bun:test";
import type { JsonRpcLiteClient } from "../client.ts";
import { bootstrapCodexThread } from "../session-bootstrap.ts";

for (const sandbox of ["read-only", "workspace-write"]) {
  for (const resumeThreadId of [undefined, "existing-thread"]) {
    test(`preserves ${sandbox} when ${resumeThreadId ? "resuming" : "starting"} a thread`, async () => {
      const requests: { method: string; params: Record<string, unknown> }[] = [];
      const client = {
        initialize: async () => {},
        request: async (method: string, params: Record<string, unknown>) => {
          requests.push({ method, params });
          throw new Error("sandbox unavailable");
        },
      } as unknown as JsonRpcLiteClient;
      await expect(
        bootstrapCodexThread(client, {
          agentId: "sandbox-test",
          cwd: "/workspace",
          modelFamily: "gpt-5.6-sol",
          effort: "high",
          permissionMode: "on-request",
          systemPrompt: "",
          sandbox,
          resumeThreadId,
        }),
      ).rejects.toThrow("sandbox unavailable");
      expect(requests).toHaveLength(1);
      expect(requests[0]?.params.sandbox).toBe(sandbox);
      expect(requests[0]?.params.approvalPolicy).toBe("on-request");
    });
  }
}
