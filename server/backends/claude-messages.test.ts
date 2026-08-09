import { describe, expect, test } from "bun:test";

import { normalizeClaudeMessage, sanitizeTaskLabel, TaskBreadcrumbTracker } from "./claude-messages.ts";

// A FOREGROUND Bash emits the same local_bash task_started/task_notification
// pair as a background one — the only difference is run_in_background in the
// launching tool_use — so every background-Bash fixture here launches through
// bgBashLaunch first. The tracker used to key off task_type alone and
// breadcrumbed both.
function bgBashLaunch() {
  return {
    type: "assistant",
    message: { content: [{ type: "tool_use", id: "toolu_bash", name: "Bash", input: { command: "tail -f gate.log", run_in_background: true } }] },
  } as any;
}

function fgBashLaunch(id = "toolu_bash", command = "bun test") {
  return {
    type: "assistant",
    message: { content: [{ type: "tool_use", id, name: "Bash", input: { command } }] },
  } as any;
}

function bashTaskStarted(overrides: Record<string, unknown> = {}) {
  return {
    type: "system",
    subtype: "task_started",
    task_id: "task-1",
    tool_use_id: "toolu_bash",
    task_type: "local_bash",
    description: "tail -f gate.log",
    ...overrides,
  } as any;
}

function bashTaskNotification(overrides: Record<string, unknown> = {}) {
  return {
    type: "system",
    subtype: "task_notification",
    task_id: "task-1",
    status: "completed",
    ...overrides,
  } as any;
}

describe("TaskBreadcrumbTracker", () => {
  test("surfaces local bash background task start and completion", () => {
    const tracker = new TaskBreadcrumbTracker();

    tracker.observe({
      type: "assistant",
      message: { content: [{ type: "tool_use", id: "tool-1", name: "Bash", input: { command: "curl localhost:4000/tasks", run_in_background: true } }] },
    } as any);

    expect(
      tracker.observe({
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
        tool_use_id: "tool-1",
        task_type: "local_bash",
        description: "curl localhost:4000/tasks",
      } as any),
    ).toEqual([{ kind: "task_lifecycle", phase: "started", taskId: "task-1", label: "Background task started: curl localhost:4000/tasks" }]);

    expect(
      tracker.observe({
        type: "system",
        subtype: "task_notification",
        task_id: "task-1",
        status: "completed",
        summary: 'Background command "curl localhost:4000/tasks" completed (exit code 0)',
      } as any),
    ).toEqual([{ kind: "task_lifecycle", phase: "completed", taskId: "task-1", label: 'Background command "curl localhost:4000/tasks" completed (exit code 0)' }]);
  });

  test("filters ordinary foreground task notifications", () => {
    const tracker = new TaskBreadcrumbTracker();

    expect(
      tracker.observe({
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
        task_type: "local_agent",
        description: "Review implementation",
      } as any),
    ).toEqual([]);

    expect(
      tracker.observe({
        type: "system",
        subtype: "task_notification",
        task_id: "task-1",
        status: "completed",
        summary: "Task completed",
      } as any),
    ).toEqual([]);
  });

  test("tracks run_in_background tool uses", () => {
    const tracker = new TaskBreadcrumbTracker();

    expect(
      tracker.observe({
        type: "assistant",
        message: {
          content: [{ type: "tool_use", id: "tool-1", name: "Task", input: { run_in_background: true } }],
        },
      } as any),
    ).toEqual([]);

    expect(
      tracker.observe({
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
        tool_use_id: "tool-1",
        task_type: "local_agent",
        description: "Audit logs",
      } as any),
    ).toEqual([{ kind: "task_lifecycle", phase: "started", taskId: "task-1", label: "Background agent started: Audit logs" }]);
  });

  test("surfaces foreground tasks when they move to the background", () => {
    const tracker = new TaskBreadcrumbTracker();

    expect(
      tracker.observe({
        type: "system",
        subtype: "task_updated",
        task_id: "task-1",
        patch: { is_backgrounded: true, description: "Long running tests" },
      } as any),
    ).toEqual([{ kind: "task_lifecycle", phase: "started", taskId: "task-1", label: "Task moved to background: Long running tests" }]);
  });

  test("stays silent for a foreground Bash start AND settle", () => {
    const tracker = new TaskBreadcrumbTracker();

    // Ordinary foreground Bash: tool_use WITHOUT run_in_background, then the
    // same local_bash task_started/task_notification pair a background one
    // emits. Both ends must be silent — the Bash call already renders as a tool
    // call, and "Background task started" is a lie about what ran.
    tracker.observe(fgBashLaunch());
    expect(tracker.observe(bashTaskStarted({ description: "bun test" }))).toEqual([]);
    expect(tracker.observe(bashTaskNotification({ summary: "bun test completed" }))).toEqual([]);
  });

  test("stays silent for a local_bash start with no launching tool_use at all", () => {
    const tracker = new TaskBreadcrumbTracker();

    expect(tracker.observe(bashTaskStarted())).toEqual([]);
    expect(tracker.observe(bashTaskNotification())).toEqual([]);
  });

  test("does not let a foreground Bash inherit an unrelated background id", () => {
    const tracker = new TaskBreadcrumbTracker();

    tracker.observe(bgBashLaunch());
    tracker.observe(fgBashLaunch("toolu_fg", "ls"));
    // Foreground task_started first: silent, and it must not consume the
    // pending background id.
    expect(tracker.observe(bashTaskStarted({ task_id: "fg1", tool_use_id: "toolu_fg" }))).toEqual([]);
    expect(tracker.observe(bashTaskStarted({ task_id: "bg1", tool_use_id: "toolu_bash" }))).toHaveLength(1);
  });

  test("still breadcrumbs a foreground Bash that is backgrounded mid-run", () => {
    const tracker = new TaskBreadcrumbTracker();

    tracker.observe(fgBashLaunch());
    expect(tracker.observe(bashTaskStarted({ description: "bun test" }))).toEqual([]);
    // Ctrl+B / auto-background on timeout: the real promotion, and it stays
    // visible.
    expect(
      tracker.observe({
        type: "system",
        subtype: "task_updated",
        task_id: "task-1",
        patch: { is_backgrounded: true, description: "bun test" },
      } as any),
    ).toEqual([{ kind: "task_lifecycle", phase: "started", taskId: "task-1", label: "Task moved to background: bun test" }]);
    expect(tracker.observe(bashTaskNotification())).toHaveLength(1);
  });

  test("honors skip_transcript and caps labels", () => {
    const tracker = new TaskBreadcrumbTracker();

    tracker.observe(bgBashLaunch());
    expect(tracker.observe(bashTaskStarted({ description: "hidden task", skip_transcript: true }))).toEqual([]);

    expect(
      tracker.observe({
        type: "system",
        subtype: "task_notification",
        task_id: "task-1",
        status: "completed",
        summary: "hidden task completed",
      } as any),
    ).toEqual([]);

    expect(sanitizeTaskLabel(`  ${"word ".repeat(80)}  `)).toHaveLength(200);
  });

  test("normalizes permission denied system events", () => {
    expect(
      normalizeClaudeMessage(
        {
          type: "system",
          subtype: "permission_denied",
          tool_use_id: "tool-1",
          tool_name: "Bash",
          message: "blocked by policy",
          decision_reason: "deny rule matched",
          agent_id: "subagent-1",
        } as any,
        "agent-1",
      ),
    ).toEqual([
      {
        kind: "permission_denied",
        toolUseId: "tool-1",
        toolName: "Bash",
        message: "blocked by policy",
        decisionReason: "deny rule matched",
        agentId: "subagent-1",
      },
    ]);
  });
});
