import type { Attachment } from "../../shared/types.ts";

// Backends use `filename` (relative to the agent's attachments dir, resolved
// via persistence.getFilePath) to read the bytes and embed them in whatever
// shape the underlying transport wants.
export type AttachmentSpec = Attachment;

// Same shape Claude's `result` message reports, normalized to camelCase. Codex
// emits these via `thread/tokenUsage/updated` and on `turn/completed`.
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  cacheCreationInputTokens: number;
}

// Single contract yielded by BackendSession.stream(); per-backend translation
// happens at the backend boundary.
export type NormalizedEvent =
  | {
      kind: "system_init";
      sessionId?: string;
      slashCommands?: string[];
      model?: string;
    }
  | { kind: "assistant_text"; text: string }
  | { kind: "thinking"; text: string; durationMs?: number }
  | { kind: "file_view"; title: string; attachments: AttachmentSpec[] }
  | {
      kind: "tool_call";
      toolUseId: string;
      name: string;
      input: Record<string, unknown>;
    }
  | {
      kind: "tool_result";
      toolUseId: string;
      content: string;
      attachments?: AttachmentSpec[];
      durationMs?: number;
      isError?: boolean;
    }
  | {
      kind: "approval_request";
      approvalId: string;
      toolName: string;
      input: Record<string, unknown>;
      title?: string;
      description?: string;
    }
  | {
      kind: "turn_completed";
      status: "completed" | "interrupted" | "failed";
      usage?: TokenUsage;
      cost?: number;
      error?: string;
      causedByAuth?: boolean;
    }
  | { kind: "usage_update"; tokenUsage: TokenUsage }
  | { kind: "compacted"; summary?: string }
  | { kind: "error"; message: string; code?: string }
  | { kind: "system_text"; text: string };

export type ApprovalDecision = { kind: "allow_persistent" } | { kind: "allow_once" } | { kind: "deny"; reason?: string };

export interface NormalizedMessage {
  uuid: string;
  role: "user" | "assistant" | "system" | "result";
  text: string;
}

// Subset of SDKControlGetContextUsageResponse used by the /context UI. Codex
// doesn't expose an equivalent at v1; backends that don't support it return
// null from getContextUsage.
export interface ContextUsage {
  model: string;
  totalTokens: number;
  maxTokens: number;
  percentage: number;
  categories?: { name: string; tokens: number }[];
  memoryFiles?: { path: string; tokens: number }[];
  systemPromptSections?: { name: string; tokens: number }[];
  isAutoCompactEnabled?: boolean;
  autoCompactThreshold?: number;
}

export interface BackendSession {
  stream(): AsyncIterable<NormalizedEvent>;
  getContextUsage(): Promise<ContextUsage | null>;
  send(text: string, attachments?: AttachmentSpec[]): Promise<void>;
  approve(approvalId: string, decision: ApprovalDecision): Promise<void>;
  abort(): Promise<void>;
  canAbortInPlace(): boolean;
  close(): void;
}
