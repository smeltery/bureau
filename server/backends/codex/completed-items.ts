import type { AttachmentSpec, NormalizedEvent } from "../types.ts";
import { formatPatchChangeKind, formatWebSearchAction } from "./protocol-format.ts";

export function translateCompletedItem(rawItem: unknown, attachmentFromPath: (rawPath: unknown) => AttachmentSpec | null): NormalizedEvent[] {
  const item = rawItem as Record<string, unknown>;
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
        {
          kind: "tool_call",
          toolUseId,
          name: "Bash",
          input: cwd ? { command, cwd } : { command },
        },
        {
          kind: "tool_result",
          toolUseId,
          content,
          durationMs: durationMs ?? undefined,
          isError: exitCode != null && exitCode !== 0,
        },
      ];
    }
    case "fileChange": {
      const toolUseId = item.id as string;
      const changes = Array.isArray(item.changes) ? item.changes : [];
      const summary = (changes as { path?: string; kind?: unknown }[]).map((c) => `${c.path ?? "?"} (${formatPatchChangeKind(c.kind)})`).join("\n");
      const status = item.status as string | undefined;
      return [
        {
          kind: "tool_call",
          toolUseId,
          name: "Edit",
          input: { changes },
        },
        {
          kind: "tool_result",
          toolUseId,
          content: `${summary}\n\nstatus: ${status ?? "unknown"}`,
          isError: status != null && status !== "completed" && status !== "applied",
        },
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
        {
          kind: "tool_call",
          toolUseId,
          name: `mcp__${server}__${tool}`,
          input: (item.arguments ?? {}) as Record<string, unknown>,
        },
        {
          kind: "tool_result",
          toolUseId,
          content,
          durationMs: durationMs ?? undefined,
          isError: !!error,
        },
      ];
    }
    case "webSearch": {
      const toolUseId = item.id as string;
      const query = item.query as string | undefined;
      const actionSummary = formatWebSearchAction(item.action);
      return [
        {
          kind: "tool_call",
          toolUseId,
          name: "WebSearch",
          input: query ? { query } : {},
        },
        {
          kind: "tool_result",
          toolUseId,
          content: actionSummary,
          isError: false,
        },
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
    default:
      return [];
  }
}
