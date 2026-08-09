import { describe, expect, test } from "bun:test";

import { normalizeClaudeMessage } from "./claude-messages.ts";

function translate(msg: unknown) {
  return normalizeClaudeMessage(msg as any, "agent-1");
}

// The SDK forwards a subagent's tool_use/tool_result blocks on the SAME stream
// as the parent's, marked only by a non-null parent_tool_use_id. Without that
// mark the transcript reads as one flat run of tool calls (verified against a
// real office log: an Agent call, 56 rows of the subagent's Bash/Read, then the
// Agent call's own result).
describe("normalizeClaudeMessage - subagent origin", () => {
  function subagentToolUse(over: Record<string, unknown> = {}) {
    return {
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-x",
        content: [{ type: "tool_use", id: "toolu_child", name: "Read", input: {} }],
      },
      parent_tool_use_id: "toolu_parent",
      subagent_type: "Explore",
      task_description: "Find every caller of foo",
      ...over,
    };
  }

  test("marks a subagent's tool_call with the parent call id, type and description", () => {
    const events = translate(subagentToolUse());
    expect(events[0]).toMatchObject({
      kind: "tool_call",
      name: "Read",
      subagent: { parentToolUseId: "toolu_parent", type: "Explore", description: "Find every caller of foo" },
    });
  });

  test("leaves the agent's own tool_call unmarked", () => {
    const events = translate(subagentToolUse({ parent_tool_use_id: null, subagent_type: undefined, task_description: undefined }));
    expect(events[0]).toMatchObject({ kind: "tool_call" });
    expect(events[0]).not.toHaveProperty("subagent");
  });

  test("marks with the parent id alone when the SDK omits type/description", () => {
    const events = translate(subagentToolUse({ subagent_type: undefined, task_description: undefined }));
    expect(events[0]).toMatchObject({ subagent: { parentToolUseId: "toolu_parent" } });
    const { subagent } = events[0] as unknown as { subagent: Record<string, unknown> };
    expect(subagent).not.toHaveProperty("type");
    expect(subagent).not.toHaveProperty("description");
  });

  test("collapses a multi-line task description to one line", () => {
    const events = translate(subagentToolUse({ task_description: "line one\n\n  line two  " }));
    expect(events[0]).toMatchObject({ subagent: { description: "line one line two" } });
  });

  test("leaves a subagent's text and thinking alone - this marks tool cards only", () => {
    // Scope guard: the SDK only forwards subagent text when forwardSubagentText
    // is set (bureau does not set it), and if that ever changes the events must
    // keep their current shape rather than silently gaining a field.
    const events = translate({
      type: "assistant",
      message: {
        role: "assistant",
        model: "claude-x",
        content: [
          { type: "thinking", thinking: "weighing options" },
          { type: "text", text: "done" },
        ],
      },
      parent_tool_use_id: "toolu_parent",
      subagent_type: "Explore",
    });
    expect(events).toEqual([
      { kind: "thinking", text: "weighing options" },
      { kind: "assistant_text", text: "done" },
    ]);
  });

  test("marks the subagent's tool_result too", () => {
    const events = translate({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_child", content: "done" }] },
      parent_tool_use_id: "toolu_parent",
    });
    expect(events[0]).toMatchObject({ kind: "tool_result", subagent: { parentToolUseId: "toolu_parent" } });
  });

  test("leaves the agent's own tool_result unmarked", () => {
    const events = translate({
      type: "user",
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: "toolu_1", content: "done" }] },
      parent_tool_use_id: null,
    });
    expect(events[0]).not.toHaveProperty("subagent");
  });

  // A pre-existing transcript has no parent_tool_use_id field at all - not null,
  // absent - and must still translate to an unmarked entry so old logs render
  // exactly as they did before.
  test("leaves an entry with no parent_tool_use_id field at all unmarked", () => {
    const events = translate({
      type: "assistant",
      message: { role: "assistant", model: "claude-x", content: [{ type: "tool_use", id: "toolu_1", name: "Bash", input: {} }] },
    });
    expect(events[0]).not.toHaveProperty("subagent");
  });

  // The marking round-trips through the JSONL log as an opaque metadata blob
  // (persistence stringifies the whole LogEntry), so the replayed entry the UI
  // reads back is the one the backend produced.
  test("survives a JSON round-trip in the log entry's metadata", () => {
    const ev = translate(subagentToolUse())[0] as { subagent?: unknown };
    const metadata = { toolId: "toolu_child", input: {}, ...(ev.subagent ? { subagent: ev.subagent } : {}) };
    expect(JSON.parse(JSON.stringify({ metadata })).metadata.subagent).toEqual({
      parentToolUseId: "toolu_parent",
      type: "Explore",
      description: "Find every caller of foo",
    });
  });
});
