import type { SDKMessage, SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import { readFileSync, statSync } from "fs";

import { getFilePath, saveFile } from "../persistence.ts";
import type { AttachmentSpec, NormalizedEvent } from "./types.ts";

export function normalizeClaudeMessage(msg: SDKMessage, agentId: string): NormalizedEvent[] {
  switch (msg.type) {
    case "system": {
      const m = msg as any;
      if (m.subtype === "init") {
        return [{ kind: "system_init", sessionId: m.session_id, slashCommands: m.slash_commands, model: m.model }];
      }
      if (m.subtype === "local_command_output" && m.content) return [{ kind: "system_text", text: m.content }];
      return [];
    }
    case "assistant": {
      const message = (msg as any).message;
      const content = message?.content;
      if (!Array.isArray(content)) return [];
      const isSynthetic = message?.model === "<synthetic>";
      return content.flatMap((block: any): NormalizedEvent[] => {
        if (block.type === "text" && block.text) return [{ kind: isSynthetic ? "system_text" : "assistant_text", text: block.text }];
        if (block.type === "tool_use") return [{ kind: "tool_call", toolUseId: block.id, name: block.name, input: block.input ?? {} }];
        if (block.type === "thinking" && block.thinking) return [{ kind: "thinking", text: block.thinking }];
        return [];
      });
    }
    case "user": {
      const content = (msg as any).message?.content;
      if (!Array.isArray(content)) return [];
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
  for (const att of attachments) {
    const path = getFilePath(agentId, att.filename);
    if (!path) continue;
    const data = readFileSync(path);
    const base64 = data.toString("base64");
    const mediaType = att.mediaType as any;
    if (att.mediaType.startsWith("image/")) {
      content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: base64 } } as any);
    } else if (att.mediaType === "application/pdf") {
      content.push({ type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } } as any);
    } else {
      const st = statSync(path);
      content.push({ type: "text", text: `\n\n[Attached file: ${att.originalName}, ${att.mediaType}, ${st.size} bytes]\n${data.toString("utf8")}` });
    }
  }
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
