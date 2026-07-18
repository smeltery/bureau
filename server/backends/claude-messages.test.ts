import { describe, expect, test } from "bun:test";

import { normalizeClaudeMessage, sanitizeTaskLabel, TaskBreadcrumbTracker } from "./claude-messages.ts";

describe("TaskBreadcrumbTracker", () => {
  test("surfaces local bash background task start and completion", () => {
    const tracker = new TaskBreadcrumbTracker();

    expect(
      tracker.observe({
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
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

  test("honors skip_transcript and caps labels", () => {
    const tracker = new TaskBreadcrumbTracker();

    expect(
      tracker.observe({
        type: "system",
        subtype: "task_started",
        task_id: "task-1",
        task_type: "local_bash",
        description: "hidden task",
        skip_transcript: true,
      } as any),
    ).toEqual([]);

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
