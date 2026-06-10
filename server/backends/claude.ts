import {
  forkSession as sdkForkSession,
  getSessionMessages as sdkGetSessionMessages,
  query,
  type CanUseTool,
  type Options,
  type PermissionResult,
  type PermissionUpdate,
  type Query,
  type SDKMessage,
  type SDKUserMessage,
} from "@anthropic-ai/claude-agent-sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages/messages.mjs";
import { existsSync, readFileSync, statSync } from "fs";
import { join } from "path";

import { FAMILY_TO_MODEL, MODEL_FAMILIES, type ModelFamily } from "../../shared/types.ts";
import { getFilePath } from "../persistence.ts";
import { createSafetyHooks } from "../agents/session/safety/index.ts";
import { isClaudeCodeAuthenticated, isClaudeCodeInstalled } from "./claude-install-check.ts";
import type {
  ApprovalDecision,
  AttachmentSpec,
  Backend,
  BackendCapabilities,
  BackendModel,
  BackendSession,
  ContextUsage,
  CreateSessionOptions,
  ForkSessionBeforeMessageResult,
  ListModelsOptions,
  ModelOption,
  NormalizedEvent,
  NormalizedMessage,
  OneShotOptions,
  PermissionModeOption,
} from "./types.ts";

const LOGIN_INSTRUCTIONS = `To authenticate Claude Code:
1. Open the built-in terminal
2. Run \`claude\`
3. Type \`/login\`
4. Follow the auth flow

Once complete, type \`/clear\` in this conversation.`;

const ALREADY_AUTHED_INSTRUCTIONS = `Claude Code is signed in. Type \`/clear\` to refresh this agent's session and pick up the new auth.`;

const CLAUDE_CODE_NOT_INSTALLED_MESSAGE = `To install Claude Code, click [Copy to terminal] on the card below:

\`curl -fsSL https://claude.ai/install.sh | bash\`

macOS users with Homebrew can alternatively run \`brew install --cask claude-code\`.

After install, open a new shell and run \`claude\` to sign in. If \`claude\` is not found, make sure \`~/.local/bin\` is on your PATH.

Alternative: add \`ANTHROPIC_API_KEY\` to your envFile (User Settings -> Env File Path, then \`/clear\`).`;

const AUTH_ERROR_PATTERNS = /unauthori[zs]ed|not authenticated|authentication|auth.*expired|invalid.*token|login.*required|not logged in|run \/login|403|401/i;

const CLAUDE_NATIVE_BIN = resolveClaudeNativeBinary();

function resolveClaudeNativeBinary(): string {
  const anthropicDir = join(import.meta.dir, "..", "..", "node_modules", "@anthropic-ai");
  const binName = process.platform === "win32" ? "claude.exe" : "claude";
  if (process.platform === "linux") {
    const muslArch = process.arch === "arm64" ? "aarch64" : "x86_64";
    const isMusl = existsSync(`/lib/ld-musl-${muslArch}.so.1`);
    const variants = isMusl ? [`linux-${process.arch}-musl`, `linux-${process.arch}`] : [`linux-${process.arch}`, `linux-${process.arch}-musl`];
    for (const v of variants) {
      const p = join(anthropicDir, `claude-agent-sdk-${v}`, binName);
      if (existsSync(p)) return p;
    }
  }
  return join(anthropicDir, `claude-agent-sdk-${process.platform}-${process.arch}`, binName);
}

const CAPABILITIES: BackendCapabilities = {
  fork: true,
  hooks: true,
  skills: true,
  oneShot: true,
  canUseTool: true,
  topicGen: true,
  edit: true,
  mcp: true,
};

const PERMISSION_MODES: PermissionModeOption[] = [
  { value: "default", label: "Default" },
  { value: "acceptEdits", label: "Accept edits" },
  { value: "bypassPermissions", label: "Bypass permissions" },
  { value: "auto", label: "Ask in Bureau" },
];

// Push-able async iterable of user turns. In 0.3.x the SDK consumes a
// streaming-input prompt (AsyncIterable<SDKUserMessage>) for the session's
// lifetime — each pushed message drives one assistant turn. Replaces the
// 0.2.x interactive session's `.send()`. Closing the queue completes the
// prompt iterable, which lets the query() generator finish and unblocks the
// parked stream() consumer.
const QUEUE_DONE = Symbol("queue-done");

class InputQueue implements AsyncIterable<SDKUserMessage> {
  private pending: SDKUserMessage[] = [];
  private waiter: ((v: SDKUserMessage | typeof QUEUE_DONE) => void) | null = null;
  private closed = false;

  push(msg: SDKUserMessage): void {
    if (this.closed) return;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(msg);
    } else {
      this.pending.push(msg);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(QUEUE_DONE);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      if (this.pending.length > 0) {
        yield this.pending.shift()!;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<SDKUserMessage | typeof QUEUE_DONE>((resolve) => {
        this.waiter = resolve;
      });
      if (next === QUEUE_DONE) return;
      yield next;
    }
  }
}

// Low-level wrapper over query() that restores the 0.2.x interactive-session
// shape (stream / send / close) on top of 0.3.x's streaming-input model. The
// cronjob runner consumes this directly (raw SDKMessage stream); the agent
// path wraps it in ClaudeBackendSession for event normalization + approvals.
export class RawClaudeSession {
  private readonly input = new InputQueue();
  readonly query: Query;
  private closed = false;

  constructor(options: Options) {
    this.query = query({ prompt: this.input, options });
  }

  // The query generator yields every SDKMessage across all turns until close.
  stream(): AsyncIterable<SDKMessage> {
    return this.query;
  }

  async send(msg: string | SDKUserMessage): Promise<void> {
    this.input.push(typeof msg === "string" ? ({ type: "user", message: { role: "user", content: msg }, parent_tool_use_id: null } as SDKUserMessage) : msg);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // End the input stream (completes the query generator) and interrupt any
    // in-flight turn. interrupt() rejects if the query already finished, so
    // swallow — close() is idempotent and must not throw.
    this.input.close();
    void this.query.interrupt().catch(() => {});
  }
}

class ClaudeBackendSession implements BackendSession {
  private pendingApprovals = new Map<string, { input: Record<string, unknown>; suggestions?: PermissionUpdate[]; resolve: (r: PermissionResult) => void }>();
  private readonly raw: RawClaudeSession;

  constructor(
    private readonly opts: CreateSessionOptions,
    resumeSessionId?: string,
  ) {
    const options: Options = {
      model: FAMILY_TO_MODEL[opts.modelFamily as ModelFamily] ?? opts.modelFamily,
      permissionMode: opts.permissionMode as Options["permissionMode"],
      pathToClaudeCodeExecutable: CLAUDE_NATIVE_BIN,
      executableArgs: ["--append-system-prompt", opts.systemPrompt],
      cwd: opts.cwd,
      hooks: createSafetyHooks(),
      canUseTool: ((toolName, input, callbackOpts) => this.requestPermission(toolName, input, callbackOpts)) as CanUseTool,
      ...(opts.env ? { env: opts.env } : {}),
      ...(resumeSessionId ? { resume: resumeSessionId } : {}),
    };
    this.raw = new RawClaudeSession(options);
  }

  async *stream(): AsyncIterable<NormalizedEvent> {
    for await (const msg of this.raw.stream()) {
      for (const ev of normalizeClaudeMessage(msg)) yield ev;
    }
  }

  async getContextUsage(): Promise<ContextUsage | null> {
    return null;
  }

  async send(text: string, attachments?: AttachmentSpec[]): Promise<void> {
    await this.raw.send(buildUserMessage(this.opts.agentId, text, attachments ?? []));
  }

  async approve(approvalId: string, decision: ApprovalDecision): Promise<void> {
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) return;
    this.pendingApprovals.delete(approvalId);
    if (decision.kind === "deny") {
      pending.resolve({ behavior: "deny", message: decision.reason ?? "User denied." });
      return;
    }
    const updatedPermissions = decision.kind === "allow_persistent" ? pending.suggestions?.map((s) => ({ ...s, destination: "session" as const })) : undefined;
    pending.resolve({ behavior: "allow", updatedInput: pending.input, updatedPermissions });
  }

  async abort(): Promise<void> {
    this.close();
  }

  canAbortInPlace(): boolean {
    return false;
  }

  close(): void {
    this.raw.close();
  }

  private requestPermission(toolName: string, input: Record<string, unknown>, opts: Parameters<CanUseTool>[2]): Promise<PermissionResult> {
    const approvalId = opts.toolUseID;
    return new Promise<PermissionResult>((resolve) => {
      this.pendingApprovals.set(approvalId, { input, suggestions: opts.suggestions, resolve });
      opts.signal.addEventListener(
        "abort",
        () => {
          if (this.pendingApprovals.delete(approvalId)) {
            resolve({ behavior: "deny", message: "Request aborted." });
          }
        },
        { once: true },
      );
    });
  }
}

function normalizeClaudeMessage(msg: SDKMessage): NormalizedEvent[] {
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
        .map((block: any) => ({
          kind: "tool_result" as const,
          toolUseId: block.tool_use_id,
          content: typeof block.content === "string" ? block.content : JSON.stringify(block.content),
          isError: block.is_error,
        }));
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

function buildUserMessage(agentId: string, text: string, attachments: AttachmentSpec[]): SDKUserMessage {
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

// Run a single stateless prompt to completion and return the terminal result.
// Centralizes native-binary resolution and the drain-to-result loop so both
// the backend's oneShotPrompt and topic-label generation share one path. A
// string prompt (vs. a streaming iterable) makes query() run exactly one turn
// and complete after the result message.
export async function runClaudeOneShot(prompt: string, options: Options): Promise<{ subtype: "success" | "error"; result: string }> {
  const q = query({
    prompt,
    options: { pathToClaudeCodeExecutable: CLAUDE_NATIVE_BIN, ...options },
  });
  let out: { subtype: "success" | "error"; result: string } = { subtype: "error", result: "" };
  for await (const msg of q) {
    if (msg.type === "result") {
      out = msg.subtype === "success" ? { subtype: "success", result: msg.result } : { subtype: "error", result: "" };
    }
  }
  return out;
}

export const claudeBackend: Backend = {
  capabilities: CAPABILITIES,
  getModelOptions(): ModelOption[] {
    return MODEL_FAMILIES.map((m) => ({ value: m.family, label: m.label }));
  },
  getPermissionModes() {
    return PERMISSION_MODES;
  },
  async listModels(_opts: ListModelsOptions): Promise<BackendModel[]> {
    return this.getModelOptions().map((m) => ({ id: m.value, label: m.label, supportedEfforts: [], isDefault: m.value === "opus" }));
  },
  createSession(opts) {
    return new ClaudeBackendSession(opts);
  },
  resumeSession(sessionId, opts) {
    return new ClaudeBackendSession(opts, sessionId);
  },
  async forkSessionBeforeMessage(sessionId, targetMessageId): Promise<ForkSessionBeforeMessageResult> {
    const result = await sdkForkSession(sessionId, { upToMessageId: targetMessageId });
    return { kind: "fork", sessionId: result.sessionId, forkedFromSessionId: sessionId };
  },
  async getSessionMessages(sessionId): Promise<NormalizedMessage[]> {
    const messages = await sdkGetSessionMessages(sessionId);
    return messages.map((m: any) => ({
      uuid: m.uuid,
      role: m.type === "user" ? "user" : m.type === "assistant" ? "assistant" : m.type === "result" ? "result" : "system",
      text: extractMessageText(m),
    }));
  },
  async oneShotPrompt(prompt: string, opts: OneShotOptions): Promise<string> {
    const result = await runClaudeOneShot(prompt, {
      model: FAMILY_TO_MODEL[opts.modelFamily as ModelFamily] ?? FAMILY_TO_MODEL.sonnet,
      ...(opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}),
      ...(opts.env ? { env: opts.env } : {}),
    });
    return result.subtype === "success" ? result.result : "";
  },
  detectAuthError(text: string) {
    return AUTH_ERROR_PATTERNS.test(text);
  },
  getLoginInstructions(opts?: { env?: { [key: string]: string | undefined } }) {
    if (isClaudeCodeAuthenticated(opts?.env)) {
      return { text: ALREADY_AUTHED_INSTRUCTIONS };
    }
    if (isClaudeCodeInstalled()) {
      return { text: LOGIN_INSTRUCTIONS, commands: ["claude"] };
    }
    return {
      text: CLAUDE_CODE_NOT_INSTALLED_MESSAGE,
      commands: ["curl -fsSL https://claude.ai/install.sh | bash"],
    };
  },
};

function extractMessageText(m: any): string {
  const content = m.message?.content ?? m.message;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((b: any) => b.type === "text")
    .map((b: any) => b.text)
    .join("");
}
