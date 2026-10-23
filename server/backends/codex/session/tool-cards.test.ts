import { expect, test } from "bun:test";
import type { NormalizedEvent, SubagentOrigin } from "../../types.ts";
import { handleCodexNotification, type CodexNotificationDeps } from "../session-notifications.ts";
import { CodexRateLimitTracker } from "../session-rate-limits.ts";
import { CodexUsageTracker } from "../session-usage.ts";
import { CodexToolCards } from "./tool-cards.ts";

function fixture() {
  const events: NormalizedEvent[] = [];
  let activity = 0,
    retries = 0;
  const deps: CodexNotificationDeps = {
    threadId: "parent",
    childThreads: new Map<string, SubagentOrigin>(),
    toolCards: new CodexToolCards(),
    turnInFlight: true,
    turnStarting: false,
    lateToolResultNoticeArmed: false,
    lateToolResultNoticeEmitted: false,
    selfInterruptedForAuth: false,
    authSignalEmittedThisTurn: false,
    usage: new CodexUsageTracker(),
    rateLimits: new CodexRateLimitTracker(),
    setActiveTurnId() {},
    clearTurnInFlight() {
      deps.turnInFlight = false;
    },
    armLateToolResultNotice() {
      deps.lateToolResultNoticeArmed = true;
    },
    markLateToolResultNoticeEmitted() {
      deps.lateToolResultNoticeEmitted = true;
    },
    resetAuthTurnState() {},
    enqueue(event) {
      events.push(event);
    },
    enqueueAuthAwareSystemText() {},
    attachmentFromPath() {
      return null;
    },
    noteCompletedItemForCapacity() {
      activity++;
    },
    completedItemsThisAttempt: () => activity,
    capacityErrorThisAttempt: () => "overloaded",
    capacityRetryCount: () => 0,
    retryCapacityTurn() {
      retries++;
    },
  };
  const notify = (method: string, item: unknown, threadId = "parent") => handleCodexNotification({ method, params: { threadId, item } }, deps);
  return { events, deps, notify, retries: () => retries };
}

test("running commands, edits, MCP calls and delegation show one card before their result", () => {
  const items = [
    { type: "commandExecution", id: "cmd", command: "sleep 30", cwd: "/tmp", exitCode: 0, aggregatedOutput: "done" },
    { type: "fileChange", id: "edit", changes: [{ path: "a.ts", kind: "update" }], status: "completed" },
    { type: "mcpToolCall", id: "mcp", server: "office", tool: "list", arguments: { limit: 5 }, result: { ok: true } },
    { type: "collabAgentToolCall", id: "spawn", tool: "spawnAgent", prompt: "Inspect callers", receiverThreadIds: ["child"], status: "completed" },
  ];
  for (const item of items) {
    const world = fixture();
    world.notify("item/started", item);
    world.notify("item/started", item);
    expect(world.events).toHaveLength(1);
    expect(world.events[0]).toMatchObject({ kind: "tool_call", toolUseId: item.id });
    world.notify("item/completed", item);
    expect(world.events.map((event) => event.kind)).toEqual(["tool_call", "tool_result"]);
    expect(world.events[1]).toMatchObject({ toolUseId: item.id });
    if (item.type === "collabAgentToolCall") expect(world.deps.childThreads.has("child")).toBe(true);
    if (item.type === "commandExecution") expect(world.events[0]).toMatchObject({ input: { command: "sleep 30", cwd: "/tmp" } });
  }
});

test("completion-only tools and web searches retain their inputs and results", () => {
  const world = fixture();
  world.notify("item/completed", { type: "commandExecution", id: "cmd", command: "pwd" });
  world.notify("item/started", { type: "webSearch", id: "search", query: "" });
  expect(world.events).toHaveLength(2);
  world.notify("item/completed", { type: "webSearch", id: "search", query: "Bun documentation" });
  expect(world.events.map((event) => event.kind)).toEqual(["tool_call", "tool_result", "tool_call", "tool_result"]);
  expect(world.events[2]).toMatchObject({ input: { query: "Bun documentation" } });
});

test("child cards retain attribution and do not collide with parent item ids", () => {
  const world = fixture();
  const origin = { parentToolUseId: "spawn", type: "Explorer" };
  world.deps.childThreads.set("child", origin);
  const item = { type: "commandExecution", id: "same", command: "pwd" };
  world.notify("item/started", item, "unknown");
  world.notify("item/started", { type: "agentMessage", id: "text", text: "private" }, "child");
  expect(world.events).toHaveLength(0);
  world.notify("item/started", item, "child");
  world.notify("item/started", item);
  world.notify("item/completed", item);
  world.notify("item/completed", item, "child");
  expect(world.events.map((event) => event.kind)).toEqual(["tool_call", "tool_call", "tool_result", "tool_result"]);
  expect(world.events[0]).toMatchObject({ subagent: origin });
  expect(world.events[3]).toMatchObject({ subagent: origin });
  expect(world.events[1]).not.toHaveProperty("subagent");
});

test("visible tool work prevents capacity replay and late results reuse their card", () => {
  const world = fixture();
  const item = { type: "commandExecution", id: "cmd", command: "sleep 30" };
  world.notify("item/started", item);
  handleCodexNotification({ method: "turn/completed", params: { threadId: "parent", turn: { status: "failed", error: { message: "overloaded" } } } }, world.deps);
  expect(world.retries()).toBe(0);
  world.notify("item/completed", { ...item, aggregatedOutput: "finished", exitCode: 0 });
  expect(world.events.filter((event) => event.kind === "tool_call")).toHaveLength(1);
  expect(world.events.filter((event) => event.kind === "tool_result")).toHaveLength(1);
  expect(world.events).toContainEqual({ kind: "system_text", text: "Turn ended before this tool result arrived.", bureauAuthored: true, message: { key: "logs.backend.lateTool" } });
});

test("a new turn can show a reused tool id", () => {
  const world = fixture();
  const item = { type: "commandExecution", id: "cmd", command: "pwd" };
  world.notify("item/started", item);
  world.deps.toolCards!.clear();
  world.notify("item/started", item);
  expect(world.events).toHaveLength(2);
});
