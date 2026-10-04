import { describe, expect, test } from "bun:test";
import { createSafetyHooks } from "../index.ts";

async function bashDecision(command: string) {
  const hook = createSafetyHooks().PreToolUse?.[0]?.hooks[0];
  if (!hook) throw new Error("missing bash safety hook");
  return hook({ tool_name: "Bash", tool_input: { command }, cwd: process.cwd() } as never, "tool-use-1", {} as never);
}

describe("bash safety segments", () => {
  test("safe git clean dry-run does not allow a later destructive segment", async () => {
    const result = await bashDecision("git clean -n; git reset --hard");
    const output = result as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
    expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput?.permissionDecisionReason).toContain("git reset --hard");
  });

  test("safe temp removal does not allow later root removal", async () => {
    const result = await bashDecision("rm -rf /tmp/bureau-test; rm -rf /");
    const output = result as { hookSpecificOutput?: { permissionDecision?: string; permissionDecisionReason?: string } };
    expect(output.hookSpecificOutput?.permissionDecision).toBe("deny");
    expect(output.hookSpecificOutput?.permissionDecisionReason).toContain("rm -rf");
  });
});
