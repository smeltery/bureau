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

  test.each([
    "git -c core.pager=cat reset --hard",
    "git --config-env core.x=Y reset --hard",
    "git checkout -b x\ngit reset --hard",
    "(git reset --hard)",
    "{ git reset --hard; }",
    "bash -c 'git reset --hard'",
    'sh -lc "git clean -fd"',
    "eval 'git reset --hard'",
    'echo "$(git reset --hard)"',
    "echo `git stash clear`",
    'git reset "--hard"',
    "git reset $'--hard'",
    "git reset --hard x git checkout -b y",
    "rm -rf /tmp/../home/me",
    "rm -rf /tmp/build/../../etc",
    "rm -rf $TMPDIR/home",
    "rm -rf /tmp/a /home/me",
  ])("denies %s", async (command) => {
    expect(await bashDecision(command)).toBe("deny");
  });

  test.each([
    'git commit -m "never git reset --hard here"',
    "echo 'rm -rf /' > notes.txt",
    "git checkout -b feature",
    "git clean -n",
    "git restore --staged file.ts",
    "rm -rf /tmp/bureau-test",
    "rm -rf /var/tmp/cache/ /tmp/x",
    "cat <<'EOF' > script.sh\ngit reset --hard\nEOF",
  ])("allows %s", async (command) => {
    expect(await bashDecision(command)).toBeUndefined();
  });
});
