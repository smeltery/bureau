import {
  forkSession as sdkForkSession,
  getSessionMessages as sdkGetSessionMessages,
  unstable_v2_createSession,
  unstable_v2_prompt,
  unstable_v2_resumeSession,
  type CanUseTool,
  type PermissionResult,
  type PermissionUpdate,
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

class ClaudeBackendSession implements BackendSession {
  private pendingApprovals = new Map<string, { input: Record<string, unknown>; suggestions?: PermissionUpdate[]; resolve: (r: PermissionResult) => void }>();
  private readonly session: ReturnType<typeof unstable_v2_createSession>;

  constructor(
    private readonly opts: CreateSessionOptions,
    resumeSessionId?: string,
  ) {
    const sdkOpts: any = {
      model: FAMILY_TO_MODEL[opts.modelFamily as ModelFamily] ?? opts.modelFamily,
      permissionMode: opts.permissionMode,
      pathToClaudeCodeExecutable: CLAUDE_NATIVE_BIN,
      executableArgs: ["--append-system-prompt", opts.systemPrompt],
      cwd: opts.cwd,
      hooks: createSafetyHooks(),
      canUseTool: ((toolName, input, options) => this.requestPermission(toolName, input, options)) as CanUseTool,
    };
    if (opts.env) sdkOpts.env = opts.env;
    if (resumeSessionId) sdkOpts.resume = resumeSessionId;
    this.session = resumeSessionId ? unstable_v2_resumeSession(resumeSessionId, sdkOpts) : unstable_v2_createSession(sdkOpts);
  }

  async *stream(): AsyncIterable<NormalizedEvent> {
    while (true) {
      for await (const msg of this.session.stream()) {
        for (const ev of normalizeClaudeMessage(msg)) yield ev;
      }
    }
  }

  async getContextUsage(): Promise<ContextUsage | null> {
    return null;
  }

  async send(text: string, attachments?: AttachmentSpec[]): Promise<void> {
    if (attachments && attachments.length > 0) {
      await this.session.send(buildUserMessage(this.opts.agentId, text, attachments));
    } else {
      await this.session.send(text);
    }
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
    this.session.close();
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
  return { type: "user", message: { role: "user", content } } as SDKUserMessage;
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
    const result = await unstable_v2_prompt(prompt, {
      model: FAMILY_TO_MODEL[opts.modelFamily as ModelFamily] ?? FAMILY_TO_MODEL.sonnet,
      pathToClaudeCodeExecutable: CLAUDE_NATIVE_BIN,
      ...(opts.env ? { env: opts.env } : {}),
    } as any);
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
