import { describe, expect, it } from "bun:test";

import type { NormalizedEvent, SubagentOrigin } from "../types.ts";
import type { JsonRpcNotification } from "./client-types.ts";
import { handleCodexNotification } from "./session-notifications.ts";
import { CodexRateLimitTracker } from "./session-rate-limits.ts";
import { CodexUsageTracker } from "./session-usage.ts";

function deps(overrides: Partial<Parameters<typeof handleCodexNotification>[1]> = {}) {
  const events: NormalizedEvent[] = [];
  const childThreads = new Map<string, SubagentOrigin>();
  return {
    events,
    childThreads,
    deps: {
      threadId: "parent-thread",
      childThreads,
      selfInterruptedForAuth: false,
      authSignalEmittedThisTurn: false,
      usage: new CodexUsageTracker(),
      rateLimits: new CodexRateLimitTracker(),
      setActiveTurnId() {},
      clearTurnInFlight() {},
      resetAuthTurnState() {},
      enqueue(event: NormalizedEvent) {
        events.push(event);
      },
      enqueueAuthAwareSystemText() {},
      attachmentFromPath() {
        return null;
      },
      ...overrides,
    },
  };
}

function notification(method: string, params: Record<string, unknown>): JsonRpcNotification {
  return { method, params };
}

describe("handleCodexNotification - child threads", () => {
  it("renders parent collab tool calls and registers spawned child threads", () => {
    const world = deps();

    handleCodexNotification(
      notification("item/completed", {
        threadId: "parent-thread",
        item: {
          type: "collabAgentToolCall",
          id: "collab-1",
          tool: "spawnAgent",
          status: "completed",
          prompt: "Find every caller of foo",
          model: "gpt-5",
          receiverThreadIds: ["child-thread"],
          agentsStates: { "child-thread": { status: "completed", message: "done" } },
        },
      }),
      world.deps,
    );

    expect(world.childThreads.get("child-thread")).toEqual({
      parentToolUseId: "collab-1",
      type: "gpt-5",
      description: "Find every caller of foo",
    });
    expect(world.events).toEqual([
      {
        kind: "tool_call",
        toolUseId: "collab-1",
        name: "spawnAgent",
        input: {
          prompt: "Find every caller of foo",
          model: "gpt-5",
          threadIds: ["child-thread"],
        },
      },
      {
        kind: "tool_result",
        toolUseId: "collab-1",
        content: "status: completed\nchild-thread: completed - done",
        isError: false,
      },
    ]);
  });

  it("keeps a thread-start nickname when a later spawn call provides a model slug", () => {
    const world = deps();
    world.childThreads.set("child-thread", {
      parentToolUseId: "child-thread",
      type: "Explore",
      description: "Find callers",
    });

    handleCodexNotification(
      notification("item/completed", {
        threadId: "parent-thread",
        item: {
          type: "collabAgentToolCall",
          id: "collab-1",
          tool: "spawnAgent",
          status: "completed",
          prompt: "Find every caller of foo",
          model: "gpt-5",
          receiverThreadIds: ["child-thread"],
        },
      }),
      world.deps,
    );

    expect(world.childThreads.get("child-thread")).toEqual({
      parentToolUseId: "collab-1",
      type: "Explore",
      description: "Find every caller of foo",
    });
  });

  it("marks known child-thread tool items as subagent work", () => {
    const world = deps();
    handleCodexNotification(
      notification("thread/started", {
        thread: {
          id: "child-thread",
          parentThreadId: "parent-thread",
          agentNickname: "Explore",
          preview: "  Find every caller\n\nof foo  ",
        },
      }),
      world.deps,
    );

    handleCodexNotification(
      notification("item/completed", {
        threadId: "child-thread",
        item: {
          type: "commandExecution",
          id: "cmd-1",
          command: "rg foo",
          cwd: "/tmp/project",
          aggregatedOutput: "a.ts:1",
          exitCode: 0,
        },
      }),
      world.deps,
    );

    expect(world.events).toEqual([
      {
        kind: "tool_call",
        toolUseId: "cmd-1",
        name: "Bash",
        input: { command: "rg foo", cwd: "/tmp/project" },
        subagent: {
          parentToolUseId: "child-thread",
          type: "Explore",
          description: "Find every caller of foo",
        },
      },
      {
        kind: "tool_result",
        toolUseId: "cmd-1",
        content: "a.ts:1\n(exit code 0)",
        durationMs: undefined,
        isError: false,
        subagent: {
          parentToolUseId: "child-thread",
          type: "Explore",
          description: "Find every caller of foo",
        },
      },
    ]);
  });

  it("keeps child-thread assistant text out of the parent transcript", () => {
    const world = deps();
    world.childThreads.set("child-thread", { parentToolUseId: "child-thread" });

    handleCodexNotification(
      notification("item/completed", {
        threadId: "child-thread",
        item: { type: "agentMessage", text: "internal child answer" },
      }),
      world.deps,
    );

    expect(world.events).toEqual([]);
  });
});
