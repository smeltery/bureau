import type { Attachment, SubagentOrigin } from "../../shared/types.ts";
// Re-exported so backend code can name it without reaching into shared/. The
// wire/disk shape lives there because it travels as LogEntry.metadata.subagent.
export type { SubagentOrigin };

// Backends use `filename` (relative to the agent's attachments dir, resolved
// via persistence.getFilePath) to pass path notices into the model. The model
// opens attachment files lazily with its own tools instead of receiving bytes
// inlined into every turn.
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
  // Tool call. Pairs with a tool_result by `toolUseId`. `subagent` is set when
  // the call came from a subagent the agent spawned rather than from the agent
  // itself — without it the two are indistinguishable in the transcript.
  | {
      kind: "tool_call";
      toolUseId: string;
      name: string;
      input: Record<string, unknown>;
      subagent?: SubagentOrigin;
    }
  | {
      kind: "tool_result";
      toolUseId: string;
      content: string;
      attachments?: AttachmentSpec[];
      durationMs?: number;
      isError?: boolean;
      subagent?: SubagentOrigin;
    }
  // Backend-specific permission rules (Claude's suggestion updates, Codex's
  // prefix rules) are intentionally NOT exposed here — backends keep them
  // internally and apply them automatically on `allow_persistent`. Keeps the
  // orchestrator free of backend-specific permission rule shapes.
  //
  // `allowPrefixLabel` is the one crack in that wall, and it stays display-only:
  // when a backend can offer a BROADER session-scoped allow than "this exact
  // call" (Codex: the prefix rule it suggests alongside an exec approval), it
  // puts the human-readable form of that rule here and the orchestrator offers
  // it as an extra choice. The rule itself never crosses the boundary — the
  // orchestrator answers with `allow_prefix` and the backend applies whatever
  // it was holding for that approvalId.
  //
  // `allowPrefixExample` is a second ready-made label: a shorter prefix worth
  // suggesting as an alternative. Both arrive display-ready and the
  // orchestrator must not take them apart — what counts as a token is the
  // backend's business, and a label it re-split could disagree with the rule
  // the backend would actually store.
  | {
      kind: "approval_request";
      approvalId: string;
      toolName: string;
      input: Record<string, unknown>;
      title?: string;
      description?: string;
      allowPrefixLabel?: string;
      allowPrefixExample?: string;
    }
  | {
      kind: "turn_completed";
      status: "completed" | "interrupted" | "failed";
      usage?: TokenUsage;
      cost?: number;
      error?: string;
      causedByAuth?: boolean;
      causedByProviderCapacity?: boolean;
    }
  | { kind: "provider_capacity_retry"; attempt: number; maxAttempts: number; delayMs: number }
  | { kind: "usage_update"; tokenUsage: TokenUsage }
  | { kind: "compacted"; summary?: string }
  | { kind: "error"; message: string; code?: string }
  // Free-text system breadcrumb (e.g. Codex's auto-decline notices).
  //
  // The orchestrator sniffs every system_text for auth trouble, because most
  // of them are relayed provider output (Codex's stderr is the reason that
  // exists). `bureauAuthored` marks the ones Bureau wrote itself: they can
  // quote a command or a rule the user typed, and a quoted `401` is not a
  // sign-in problem. Set it ONLY for text Bureau composed — never for
  // anything relayed from a backend.
  | { kind: "system_text"; text: string; bureauAuthored?: true }
  | {
      kind: "task_lifecycle";
      phase: "started" | "completed" | "failed" | "stopped";
      taskId: string;
      label: string;
    }
  | {
      kind: "permission_denied";
      toolUseId: string;
      toolName: string;
      message: string;
      decisionReason?: string;
      agentId?: string;
    };

// Four explicit variants matching the /resolve UX. The Claude backend
// translates `allow_persistent` into session-scoped suggestion updates; the
// Codex backend maps it to codex's own `acceptForSession` (that session
// remembers the exact canonicalized command).
//
// `allow_prefix` is only ever offered when the preceding approval_request
// carried an `allowPrefixLabel`: it means "allow this call, and stop asking
// about commands that start the same way". `prefixText` is the user's own
// choice of how much to cover, passed through as the RAW TEXT they typed;
// omitted means "whatever the backend proposed". Deliberately unparsed: what
// counts as a command token is backend-shaped knowledge, so the backend does
// the splitting AND the validating — a prefix that isn't the start of the
// command being approved is refused there. Answering an approval can
// therefore never widen anything beyond that approval.
// Today only Codex offers this. Like every variant here it is session-scoped
// and in-memory: nothing is written to disk or shared with another agent.
export type ApprovalDecision = { kind: "allow_persistent" } | { kind: "allow_prefix"; prefixText?: string } | { kind: "allow_once" } | { kind: "deny"; reason?: string };

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

// Backend-agnostic subscription-allowance reading. Same shape as
// AgentSubscriptionUsage minus `primaryIndex` / `sampledAtMs` (the wire layer
// picks the leading window and stamps the time at commit time). Backends that
// can't report it leave getSubscriptionUsage undefined — the UI then shows the
// pill's unknown state.
export interface SubscriptionUsageWindow {
  label: string;
  usedPercent: number;
  resetsAtMs: number | null;
}

export interface SubscriptionUsage {
  plan: string | null;
  // Non-empty by construction: a backend with no usable window reports
  // "unavailable" instead of an empty array. Order is the backend's stable
  // DISPLAY order (most plan-shaped first), NOT a ranking — the wire layer
  // picks which window the pill shows.
  windows: SubscriptionUsageWindow[];
}

// Three outcomes, not two. The difference matters because the reading is
// long-lived: it survives /clear and only refreshes at turn boundaries, so
// "the call blew up once" and "this account has no plan allowance" must not
// be the same value.
//   usage       — a reading; replaces whatever was displayed.
//   unavailable — AUTHORITATIVE absence. The backend answered and there is no
//                 plan allowance to report (Claude API-key / Bedrock / Vertex
//                 sessions, a signed-out account). Clears the pill.
//   unknown     — we learned nothing this time (RPC failed, nothing pushed
//                 yet). Leaves the previous reading standing, so a transient
//                 blip can't blank a valid number.
export type SubscriptionUsageResult = { kind: "usage"; usage: SubscriptionUsage } | { kind: "unavailable" } | { kind: "unknown" };

export interface BackendSession {
  stream(): AsyncIterable<NormalizedEvent>;
  getContextUsage(): Promise<ContextUsage | null>;

  // How much of the signed-in account's subscription allowance is spent.
  // Account-scoped, not conversation-scoped. See SubscriptionUsageResult for
  // why "no plan limits apply" and "the call failed" are different answers.
  // Implementations must swallow their own errors and resolve "unknown"
  // rather than reject — the Claude side rides an explicitly experimental SDK
  // API, and a future change there must degrade to a stale-or-unknown pill,
  // never a crash. Backends are also free to serve a cached value here: the
  // cost policy lives with whoever pays it (Claude throttles its control RPC
  // internally; Codex is reading rate limits the app-server already pushed).
  //
  // OPTIONAL on purpose. Absent means "this backend cannot report it at all",
  // which is a legitimate answer for a session shape that has no account
  // behind it (test doubles, future backends), and keeps the contract additive
  // for every existing BackendSession implementation.
  getSubscriptionUsage?(): Promise<SubscriptionUsageResult>;
  send(text: string, attachments?: AttachmentSpec[]): Promise<void>;
  approve(approvalId: string, decision: ApprovalDecision): Promise<void>;
  abort(): Promise<void>;
  canAbortInPlace(): boolean;
  close(): void;
}
