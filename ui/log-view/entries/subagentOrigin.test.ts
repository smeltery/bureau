import { describe, expect, test } from "bun:test";

import type { LogEntry } from "../../../shared/types.ts";
import { subagentOf, subagentPillLabel, subagentPillTitle } from "./subagentOrigin.ts";

function entry(metadata?: Record<string, unknown>): LogEntry {
  return { id: "log-1", agentId: "agent-1", timestamp: 0, kind: "tool_call", content: "Read", metadata };
}

describe("subagentOf", () => {
  test("reads the marking the Claude backend wrote", () => {
    expect(subagentOf(entry({ subagent: { parentToolUseId: "toolu_parent", type: "Explore" } }))).toEqual({ parentToolUseId: "toolu_parent", type: "Explore" });
  });

  // The three ways a row is the agent's own work: an unmarked live entry (the
  // agent called the tool itself), a Codex entry (that backend has no subagent
  // concept), and an entry written before the field existed - all of which must
  // render exactly as they did before.
  test("returns undefined when the entry carries no marking", () => {
    expect(subagentOf(entry({ toolId: "toolu_1", input: {} }))).toBeUndefined();
    expect(subagentOf(entry())).toBeUndefined();
  });

  // Defensive: a truncated or hand-edited log line must not produce a pill with
  // nothing behind it, since parentToolUseId is the join back to the parent card.
  test("returns undefined when the marking has no parent tool use id", () => {
    expect(subagentOf(entry({ subagent: {} }))).toBeUndefined();
    expect(subagentOf(entry({ subagent: { parentToolUseId: "" } }))).toBeUndefined();
    expect(subagentOf(entry({ subagent: { type: "Explore" } }))).toBeUndefined();
  });
});

describe("subagentPillLabel", () => {
  test("names the subagent type when the SDK reported one", () => {
    expect(subagentPillLabel({ parentToolUseId: "toolu_parent", type: "Explore" })).toBe("subagent · Explore");
  });

  test("falls back to the bare marking when it did not", () => {
    expect(subagentPillLabel({ parentToolUseId: "toolu_parent" })).toBe("subagent");
  });
});

describe("subagentPillTitle", () => {
  test("composes type and description into the hover text", () => {
    expect(subagentPillTitle({ parentToolUseId: "toolu_parent", type: "Explore", description: "Find every caller of foo" })).toBe("Subagent (Explore): Find every caller of foo");
  });

  test("drops each half the SDK omitted", () => {
    expect(subagentPillTitle({ parentToolUseId: "toolu_parent", type: "Explore" })).toBe("Subagent (Explore)");
    expect(subagentPillTitle({ parentToolUseId: "toolu_parent", description: "Find every caller of foo" })).toBe("Subagent: Find every caller of foo");
    expect(subagentPillTitle({ parentToolUseId: "toolu_parent" })).toBe("Subagent");
  });
});
