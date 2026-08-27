import {
  forkSession as sdkForkSession,
  getSessionMessages as sdkGetSessionMessages,
  type CanUseTool,
  type Options,
  type PermissionResult,
  type PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";

import { FAMILY_TO_MODEL, MODEL_FAMILIES, type ModelFamily } from "../../shared/types.ts";
import { CLAUDE_NATIVE_BIN } from "../agents/session/claude-native.ts";
import { claudeProjectDir, claudeSessionFileExists } from "../agents/session/paths.ts";
import { createSafetyHooks } from "../agents/session/safety/index.ts";
import { isClaudeCodeAuthenticated, isClaudeCodeInstalled } from "./claude-install-check.ts";
import { createClaudeSubscriptionUsageReader, type ClaudeUsageCapableQuery } from "./claude-subscription-usage.ts";
import { buildUserMessage, extractMessageText, normalizeClaudeMessage, TaskBreadcrumbTracker } from "./claude-messages.ts";
import { RawClaudeSession, runClaudeOneShot } from "./claude-raw-session.ts";
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
  SubscriptionUsageResult,
} from "./types.ts";

export { runClaudeOneShot } from "./claude-raw-session.ts";

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
  private readonly raw: RawClaudeSession;
  private readonly taskBreadcrumbs = new TaskBreadcrumbTracker();
  // Plan-allowance reader (throttled + single-flight; see the module for why
  // the SDK method is looked up by typeof on every call). The thunk defers the
  // query lookup so field initialization order doesn't matter.
  private readonly subscriptionUsage = createClaudeSubscriptionUsageReader(() => this.raw.query as ClaudeUsageCapableQuery);

  constructor(
    private readonly opts: CreateSessionOptions,
    resumeSessionId?: string,
  ) {
    const options: Options = {
      model: FAMILY_TO_MODEL[opts.modelFamily as ModelFamily] ?? opts.modelFamily,
      permissionMode: opts.permissionMode as Options["permissionMode"],
      pathToClaudeCodeExecutable: CLAUDE_NATIVE_BIN,
      systemPrompt: { type: "preset", preset: "claude_code", append: opts.systemPrompt },
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
      for (const ev of normalizeClaudeMessage(msg, this.opts.agentId)) yield ev;
      for (const ev of this.taskBreadcrumbs.observe(msg)) yield ev;
    }
  }

  async getContextUsage(): Promise<ContextUsage | null> {
    const ctx = await this.raw.query.getContextUsage();
    return {
      model: ctx.model,
      totalTokens: ctx.totalTokens,
      maxTokens: ctx.maxTokens,
      percentage: ctx.percentage,
      categories: ctx.categories?.map((cat) => ({ name: cat.name, tokens: cat.tokens })),
      memoryFiles: ctx.memoryFiles?.map((file) => ({ path: file.path, tokens: file.tokens })),
      systemPromptSections: ctx.systemPromptSections?.map((section) => ({ name: section.name, tokens: section.tokens })),
      isAutoCompactEnabled: ctx.isAutoCompactEnabled,
      autoCompactThreshold: ctx.autoCompactThreshold,
    };
  }

  // Plan-allowance usage of the signed-in claude.ai account (tri-state; see
  // SubscriptionUsageResult).
  async getSubscriptionUsage(): Promise<SubscriptionUsageResult> {
    return this.subscriptionUsage();
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
    // The Claude backend never sets allowPrefixLabel, so the /resolve UX never
    // offers option 4 here. An "allow_prefix" arriving anyway therefore lands
    // in the same branch as allow_once: a one-shot allow is the safe reading of
    // "allow, and take this rule too" from a backend that has no rule to take.
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
  checkSessionResumable(sessionId, opts) {
    if (claudeSessionFileExists(opts.cwd, sessionId, opts.env)) return null;
    return (
      `Cannot resume session ${sessionId.slice(0, 8)}...: its file is missing from ${claudeProjectDir(opts.cwd, opts.env)}. ` +
      "Most commonly this happens after the cwd was moved or renamed - the Claude CLI stores sessions under a path derived from cwd."
    );
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
