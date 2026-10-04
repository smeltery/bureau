import { describe, expect, test } from "bun:test";
import type { PreToolUseHookInput } from "@anthropic-ai/claude-agent-sdk";
import { createSafetyHooks } from "../index.ts";

async function bashDecision(command: string): Promise<string | undefined> {
  const hook = createSafetyHooks().PreToolUse?.find((entry) => entry.matcher === "Bash")?.hooks[0];
  if (!hook) throw new Error("Bash safety hook missing");
  const input: PreToolUseHookInput = {
    session_id: "test-session",
    transcript_path: "/tmp/transcript.jsonl",
    cwd: "/tmp",
    hook_event_name: "PreToolUse",
    tool_name: "Bash",
    tool_input: { command },
    tool_use_id: "tool-1",
  };
  const result = await hook(input, "", { signal: new AbortController().signal });
  const output = "hookSpecificOutput" in result ? result.hookSpecificOutput : undefined;
  return output && "permissionDecision" in output ? output.permissionDecision : undefined;
}

describe("destructive command segment safety", () => {
  test("does not let a temp rm allowlist bless a later destructive segment", async () => {
    expect(await bashDecision("rm -rf /tmp/bureau-test && rm -rf build")).toBe("deny");
  });

  test("checks git subcommands behind global options", async () => {
    expect(await bashDecision("git -C repo --no-pager reset --hard")).toBe("deny");
  });
});
