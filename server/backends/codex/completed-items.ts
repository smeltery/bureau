import type { AttachmentSpec, NormalizedEvent, SubagentOrigin } from "../types.ts";
import { formatPatchChangeKind, formatWebSearchAction } from "./protocol-format.ts";

const SUBAGENT_VISIBLE_ITEMS = new Set(["commandExecution", "fileChange", "mcpToolCall", "webSearch"]);

export function isToolActivityItem(rawItem: unknown): boolean {
  const type = (rawItem as { type?: unknown } | null)?.type;
  return typeof type === "string" && SUBAGENT_VISIBLE_ITEMS.has(type);
}

export interface CompletedItemOptions {
  subagent?: SubagentOrigin;
  registerChildThread?(threadId: string, origin: SubagentOrigin): void;
}

function withSubagent<T extends NormalizedEvent>(event: T, subagent?: SubagentOrigin): T {
  if (!subagent) return event;
  if (event.kind !== "tool_call" && event.kind !== "tool_result") return event;
  return { ...event, subagent };
}

function subagentLabel(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 200);
}

export function translateCompletedItem(rawItem: unknown, attachmentFromPath: (rawPath: unknown) => AttachmentSpec | null, options: CompletedItemOptions = {}): NormalizedEvent[] {
  const item = rawItem as Record<string, unknown>;
  const subagent = options.subagent;
  if (subagent && !SUBAGENT_VISIBLE_ITEMS.has(item?.type as string)) return [];
  switch (item?.type) {
    case "agentMessage": {
      const text = item.text as string | undefined;
      return text ? [{ kind: "assistant_text", text }] : [];
    }
    case "reasoning": {
      const summary = Array.isArray(item.summary) ? item.summary.join("\n") : "";
      const content = Array.isArray(item.content) ? item.content.join("\n") : "";
      const joined = [summary, content].filter(Boolean).join("\n\n");
      return joined ? [{ kind: "thinking", text: joined }] : [];
    }
    case "commandExecution": {
      const command = item.command as string | undefined;
      const cwd = item.cwd as string | undefined;
      const aggregatedOutput = item.aggregatedOutput as string | undefined;
      const exitCode = item.exitCode as number | undefined;
      const durationMs = item.durationMs as number | undefined;
      const toolUseId = item.id as string;
      const content = (aggregatedOutput ?? "") + (exitCode != null ? `\n(exit code ${exitCode})` : "");
      return [
        withSubagent(
          {
            kind: "tool_call",
            toolUseId,
            name: "Bash",
            input: cwd ? { command, cwd } : { command },
          },
          subagent,
        ),
        withSubagent(
          {
            kind: "tool_result",
            toolUseId,
            content,
            durationMs: durationMs ?? undefined,
            isError: exitCode != null && exitCode !== 0,
          },
          subagent,
        ),
      ];
    }
    case "fileChange": {
      const toolUseId = item.id as string;
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const summary = (changes as { path?: string; kind?: unknown }[]).map((c) => `${c.path ?? "?"} (${formatPatchChangeKind(c.kind)})`).join("\n");
      const status = item.status as string | undefined;
      return [
        withSubagent(
          {
            kind: "tool_call",
            toolUseId,
            name: "Edit",
            input: { changes },
          },
          subagent,
        ),
        withSubagent(
          {
            kind: "tool_result",
            toolUseId,
            content: `${summary}\n\nstatus: ${status ?? "unknown"}`,
            isError: status != null && status !== "completed" && status !== "applied",
          },
          subagent,
        ),
      ];
    }
    case "mcpToolCall": {
      const toolUseId = item.id as string;
      const server = item.server as string;
      const tool = item.tool as string;
      const durationMs = item.durationMs as number | undefined;
      const result = item.result;
      const error = item.error;
      const content = error ? `Error: ${JSON.stringify(error)}` : JSON.stringify(result ?? {});
      return [
        withSubagent(
          {
            kind: "tool_call",
            toolUseId,
            name: `mcp__${server}__${tool}`,
            input: (item.arguments ?? {}) as Record<string, unknown>,
          },
          subagent,
        ),
        withSubagent(
          {
            kind: "tool_result",
            toolUseId,
            content,
            durationMs: durationMs ?? undefined,
            isError: !!error,
          },
          subagent,
        ),
      ];
    }
    case "webSearch": {
      const toolUseId = item.id as string;
      const query = item.query as string | undefined;
      const actionSummary = formatWebSearchAction(item.action);
      return [
        withSubagent(
          {
            kind: "tool_call",
            toolUseId,
            name: "WebSearch",
            input: query ? { query } : {},
          },
          subagent,
        ),
        withSubagent(
          {
            kind: "tool_result",
            toolUseId,
            content: actionSummary,
            isError: false,
          },
          subagent,
        ),
      ];
    }
    case "plan": {
      const text = item.text as string | undefined;
      return text ? [{ kind: "thinking", text }] : [];
    }
    case "imageView": {
      const att = attachmentFromPath(item.path);
      return att ? [{ kind: "file_view", title: att.originalName, attachments: [att] }] : [{ kind: "system_text", text: `Codex viewed an image, but Bureau could not display it.` }];
    }
    case "imageGeneration": {
      const att = attachmentFromPath(item.savedPath);
      if (att) {
        const title = typeof item.revisedPrompt === "string" && item.revisedPrompt.trim() ? item.revisedPrompt : att.originalName;
        return [{ kind: "file_view", title, attachments: [att] }];
      }
      if (item.status === "failed") {
        const result = typeof item.result === "string" ? item.result : "";
        return [{ kind: "system_text", text: result ? `Codex image generation failed: ${result}` : `Codex image generation failed.` }];
      }
      return [{ kind: "system_text", text: `Codex generated an image, but Bureau could not display it.` }];
    }
    case "contextCompaction":
      return [{ kind: "compacted" }];
    case "collabAgentToolCall": {
      const toolUseId = item.id as string;
      const tool = typeof item.tool === "string" ? item.tool : "collabAgent";
      const status = item.status as string | undefined;
      const prompt = typeof item.prompt === "string" ? item.prompt : null;
      const model = typeof item.model === "string" ? item.model : null;
      const receivers = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds.filter((receiver): receiver is string => typeof receiver === "string" && receiver.length > 0) : [];
      if (tool === "spawnAgent") {
        for (const childId of receivers) {
          options.registerChildThread?.(childId, {
            parentToolUseId: toolUseId,
            ...(model ? { type: model } : {}),
            ...(prompt ? { description: subagentLabel(prompt) } : {}),
          });
        }
      }
      const states = item.agentsStates as Record<string, { status?: string; message?: string | null } | undefined> | null | undefined;
      const stateLines = states ? Object.entries(states).map(([threadId, state]) => `${threadId}: ${state?.status ?? "?"}${state?.message ? ` - ${state.message}` : ""}`) : [];
      return [
        {
          kind: "tool_call",
          toolUseId,
          name: tool,
          input: {
            ...(prompt ? { prompt } : {}),
            ...(model ? { model } : {}),
            ...(receivers.length > 0 ? { threadIds: receivers } : {}),
          },
        },
        {
          kind: "tool_result",
          toolUseId,
          content: [`status: ${status ?? "unknown"}`, ...stateLines].join("\n"),
          isError: status === "failed",
        },
      ];
    }
    case "subAgentActivity": {
      const childId = typeof item.agentThreadId === "string" ? item.agentThreadId : null;
      if (childId) {
        const path = typeof item.agentPath === "string" ? item.agentPath : "";
        const name = path ? (path.split(/[\\/]/).pop() ?? "").replace(/\.[^.]*$/, "") : "";
        options.registerChildThread?.(childId, {
          parentToolUseId: (item.id as string) || childId,
          ...(name ? { type: name } : {}),
        });
      }
      return [];
    }
    default:
      return [];
  }
}
