import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages/messages.mjs";

import { formatAttachmentLines, resolveAttachmentNotices } from "../attachment-prompt.ts";
import { saveFile } from "../persistence.ts";
import type { AttachmentSpec, NormalizedEvent, SubagentOrigin } from "./types.ts";

// Which loop produced an assistant/user message. The SDK sets
// `parent_tool_use_id` to the Agent/Task tool_use id when the message comes
// from a subagent, and null when it comes from the agent's own loop. Subagent
// tool calls ride the SAME message stream as the parent's (the SDK forwards
// tool_use/tool_result blocks from subagents unconditionally; only their text
// is gated behind `forwardSubagentText`), so without this the transcript reads
// as one flat run of tool calls with no way to tell who made them.
//
// `subagent_type` and `task_description` are model-authored free text, so they
// go through the same one-line cap as the task breadcrumbs. Older SDKs omit
// both; the parent id alone is still enough to mark the call.
function subagentOriginOf(msg: { parent_tool_use_id?: string | null; subagent_type?: string; task_description?: string }): SubagentOrigin | undefined {
  const parentToolUseId = msg.parent_tool_use_id;
  if (!parentToolUseId) return undefined;
  const type = msg.subagent_type ? sanitizeTaskLabel(msg.subagent_type) : "";
  const description = msg.task_description ? sanitizeTaskLabel(msg.task_description) : "";
  return { parentToolUseId, ...(type ? { type } : {}), ...(description ? { description } : {}) };
}

export function normalizeClaudeMessage(msg: SDKMessage, agentId: string): NormalizedEvent[] {
  switch (msg.type) {
    case "system": {
      const m = msg as any;
      if (m.subtype === "init") {
        return [{ kind: "system_init", sessionId: m.session_id, slashCommands: m.slash_commands, model: m.model }];
      }
      if (m.subtype === "local_command_output" && m.content) return [{ kind: "system_text", text: m.content }];
      if (m.subtype === "permission_denied") {
        return [
          {
            kind: "permission_denied",
            toolUseId: typeof m.tool_use_id === "string" ? m.tool_use_id : "",
            toolName: typeof m.tool_name === "string" ? m.tool_name : "Tool",
            message: sanitizeTaskLabel(typeof m.message === "string" ? m.message : ""),
            ...(typeof m.decision_reason === "string" ? { decisionReason: sanitizeTaskLabel(m.decision_reason) } : {}),
            ...(typeof m.agent_id === "string" ? { agentId: m.agent_id } : {}),
          },
        ];
      }
      return [];
    }
    case "assistant": {
      const message = (msg as any).message;
      const content = message?.content;
      if (!Array.isArray(content)) return [];
      const isSynthetic = message?.model === "<synthetic>";
      const subagent = subagentOriginOf(msg as any);
      return content.flatMap((block: any): NormalizedEvent[] => {
        if (block.type === "text" && block.text) return [{ kind: isSynthetic ? "system_text" : "assistant_text", text: block.text }];
        if (block.type === "tool_use") return [{ kind: "tool_call", toolUseId: block.id, name: block.name, input: block.input ?? {}, ...(subagent ? { subagent } : {}) }];
        if (block.type === "thinking" && block.thinking) return [{ kind: "thinking", text: block.thinking }];
        return [];
      });
    }
    case "user": {
      const content = (msg as any).message?.content;
      if (!Array.isArray(content)) return [];
      const subagent = subagentOriginOf(msg as any);
      return content
        .filter((block: any) => block.type === "tool_result")
        .map((block: any) => {
          const text =
            typeof block.content === "string"
              ? block.content
              : Array.isArray(block.content)
                ? block.content
                    .filter((c: any) => c.type === "text")
                    .map((c: any) => c.text)
                    .join("\n") || JSON.stringify(block.content)
                : JSON.stringify(block.content);
          return {
            kind: "tool_result" as const,
            toolUseId: block.tool_use_id,
            content: text,
            attachments: attachmentsFromClaudeToolResult(agentId, block.content),
            isError: block.is_error,
            ...(subagent ? { subagent } : {}),
          };
        });
    }
    case "result": {
      const m = msg as any;
      return [
        {
          kind: "turn_completed",
          status: m.subtype === "success" ? "completed" : "failed",
          error: m.subtype === "success" ? undefined : (m.error ?? m.subtype),
          cost: m.total_cost_usd,
          usage: m.usage
            ? {
                inputTokens: m.usage.input_tokens ?? 0,
                outputTokens: m.usage.output_tokens ?? 0,
                cacheReadInputTokens: m.usage.cache_read_input_tokens ?? 0,
                cacheCreationInputTokens: m.usage.cache_creation_input_tokens ?? 0,
              }
            : undefined,
        },
      ];
    }
    default:
      return [];
  }
}

export function buildUserMessage(agentId: string, text: string, attachments: AttachmentSpec[]): SDKUserMessage {
  const content: ContentBlockParam[] = [{ type: "text", text }];
  const attachmentLines = formatAttachmentLines(resolveAttachmentNotices(agentId, attachments));
  if (attachmentLines.length > 0) content.push({ type: "text", text: attachmentLines.join("\n") });
  return { type: "user", message: { role: "user", content }, parent_tool_use_id: null } as SDKUserMessage;
}

export function extractMessageText(m: any): string {
  const content = m.message?.content ?? m.message;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
}

const TASK_LABEL_MAX = 200;
const TRACKED_TASKS_MAX = 200;
const BACKGROUND_TOOL_IDS_MAX = 500;

export function sanitizeTaskLabel(text: string): string {
  const oneLine = text.replace(/\s+/g, " ").trim();
  return oneLine.length > TASK_LABEL_MAX ? `${oneLine.slice(0, TASK_LABEL_MAX - 3)}...` : oneLine;
}

// ---------------------------------------------------------------------------
// Background-task lifecycle breadcrumbs (TaskBreadcrumbTracker)
// ---------------------------------------------------------------------------
// The SDK emits system/task_started, task_updated, and task_notification for
// EVERY task-shaped thing — including ordinary foreground Bash calls and
// foreground subagents, which already render as their own tool calls.
// Breadcrumbing all of them would double-render every shell command, so this
// tracker only surfaces genuinely-background work:
//
//   any tool_use launched with input.run_in_background === true — the ONLY
//                                 signal that a Bash call or an Agent-tool
//                                 subagent was born background; their
//                                 task_started is otherwise identical to a
//                                 foreground one's
//   task_type "local_workflow"  — Workflow tool runs (return immediately,
//                                 settle via task_notification). No
//                                 run_in_background input to correlate
//                                 against, and there is no foreground
//                                 counterpart, so the task_type alone is safe.
//   task_updated is_backgrounded — a foreground task backgrounded mid-run
//                                 (Ctrl+B / auto-background on timeout)
//
// task_type "local_bash" is NOT a background signal: the SDK stamps it on every
// local shell task, foreground included. Trusting it made ordinary Bash calls
// emit "Background task started" — measured at 217 of 227 breadcrumbs on one
// agent and 78 of 78 on another, which in turn made earlyoom incidents look
// like mid-run backgrounding.
//
// Settle breadcrumbs (task_notification) are emitted only for tasks tracked
// at start, which both filters foreground-subagent noise and dedupes repeated
// notifications for the same task. skip_transcript (ambient/housekeeping
// tasks) mutes both ends.
export class TaskBreadcrumbTracker {
  private tracked = new Map<string, { desc: string; silent: boolean }>();
  private backgroundToolUseIds = new Set<string>();

  observe(msg: SDKMessage): NormalizedEvent[] {
    const raw = msg as any;
    if (msg.type === "assistant") {
      const content = raw.message?.content;
      if (!Array.isArray(content)) return [];
      for (const block of content) {
        if (block?.type === "tool_use" && block.input?.run_in_background === true && typeof block.id === "string") {
          this.backgroundToolUseIds.add(block.id);
          trimInsertionOrdered(this.backgroundToolUseIds, BACKGROUND_TOOL_IDS_MAX);
        }
      }
      return [];
    }

    if (msg.type !== "system") return [];
    if (raw.subtype === "task_started") return this.observeStarted(raw);
    if (raw.subtype === "task_updated") return this.observeUpdated(raw);
    if (raw.subtype === "task_notification") return this.observeNotification(raw);
    return [];
  }

  private observeStarted(msg: any): NormalizedEvent[] {
    const taskId = typeof msg.task_id === "string" ? msg.task_id : "";
    if (!taskId || this.tracked.has(taskId)) return [];
    const toolUseId = typeof msg.tool_use_id === "string" ? msg.tool_use_id : undefined;
    const isBackground = msg.task_type === "local_workflow" || (toolUseId != null && this.backgroundToolUseIds.has(toolUseId));
    if (!isBackground) return [];
    if (toolUseId) this.backgroundToolUseIds.delete(toolUseId);
    const desc = sanitizeTaskLabel(typeof msg.description === "string" && msg.description ? msg.description : taskId);
    const silent = msg.skip_transcript === true;
    this.tracked.set(taskId, { desc, silent });
    trimInsertionOrdered(this.tracked, TRACKED_TASKS_MAX);
    if (silent) return [];
    const kindWord = msg.task_type === "local_workflow" ? "Workflow" : msg.task_type === "local_agent" ? "Background agent" : "Background task";
    return [{ kind: "task_lifecycle", phase: "started", taskId, label: sanitizeTaskLabel(`${kindWord} started: ${desc}`) }];
  }

  private observeUpdated(msg: any): NormalizedEvent[] {
    const taskId = typeof msg.task_id === "string" ? msg.task_id : "";
    if (!taskId || this.tracked.has(taskId) || msg.patch?.is_backgrounded !== true) return [];
    const desc = sanitizeTaskLabel(typeof msg.patch?.description === "string" && msg.patch.description ? msg.patch.description : taskId);
    this.tracked.set(taskId, { desc, silent: false });
    trimInsertionOrdered(this.tracked, TRACKED_TASKS_MAX);
    return [{ kind: "task_lifecycle", phase: "started", taskId, label: sanitizeTaskLabel(`Task moved to background: ${desc}`) }];
  }

  private observeNotification(msg: any): NormalizedEvent[] {
    const taskId = typeof msg.task_id === "string" ? msg.task_id : "";
    const rec = taskId ? this.tracked.get(taskId) : undefined;
    if (!taskId || !rec) return [];
    this.tracked.delete(taskId);
    if (rec.silent || msg.skip_transcript === true) return [];
    const rawStatus = typeof msg.status === "string" ? msg.status : "completed";
    const phase = rawStatus === "failed" || rawStatus === "stopped" ? rawStatus : "completed";
    const label = sanitizeTaskLabel(typeof msg.summary === "string" && msg.summary ? msg.summary : `Background task ${phase}: ${rec.desc}`);
    return [{ kind: "task_lifecycle", phase, taskId, label }];
  }
}

function trimInsertionOrdered(coll: Map<string, unknown> | Set<string>, max: number) {
  while (coll.size > max) {
    const oldest = coll.keys().next().value;
    if (oldest === undefined) break;
    coll.delete(oldest);
  }
}

function attachmentsFromClaudeToolResult(agentId: string, content: unknown): AttachmentSpec[] | undefined {
  if (!Array.isArray(content)) return undefined;
  const attachments: AttachmentSpec[] = [];
  for (const block of content as any[]) {
    if (block.type !== "image" || block.source?.type !== "base64") continue;
    const mediaType = typeof block.source.media_type === "string" ? block.source.media_type : "image/png";
    const extension = mediaType.split("/")[1] || "png";
    const att = saveFile(agentId, Buffer.from(block.source.data, "base64"), mediaType, `image.${extension}`);
    if (att) attachments.push(att);
  }
  return attachments.length > 0 ? attachments : undefined;
}
