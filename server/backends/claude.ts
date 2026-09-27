import {
  forkSession as sdkForkSession,
  getSessionMessages as sdkGetSessionMessages,
  type CanUseTool,
  type ForkSessionOptions,
  type GetSessionMessagesOptions,
  type HookCallbackMatcher,
  type HookEvent,
  type Options,
  type PermissionResult,
  type PermissionUpdate,
} from "@anthropic-ai/claude-agent-sdk";

import { FAMILY_TO_MODEL, MODEL_FAMILIES, type ModelFamily } from "../../shared/types.ts";
import { CLAUDE_NATIVE_BIN } from "../agents/session/claude-native.ts";
import { claudeProjectDir, claudeSessionFileExists } from "../agents/session/paths.ts";
import { createSafetyHooks } from "../agents/session/safety/index.ts";
import { isClaudeCloudSelected, isClaudeCodeAuthenticated, isClaudeCodeInstalled } from "./claude-install-check.ts";
import { createClaudeSubscriptionUsageReader, type ClaudeUsageCapableQuery } from "./claude-subscription-usage.ts";
import { claudeSessionStore } from "./claude/session-store.ts";
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

const LOGIN_INSTRUCTIONS = `Claude authentication failed.

Open User Settings → Connections to paste an ANTHROPIC_API_KEY, or sign in on the host:

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

Alternative: open User Settings → Connections and paste an ANTHROPIC_API_KEY, then \`/clear\`.`;

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

export const TOOL_BOUNDARY_HOOK_TIMEOUT_S = 60;

export function toolBoundaryHooks(take: () => string | null): HookCallbackMatcher[] {
  return [
    {
      timeout: TOOL_BOUNDARY_HOOK_TIMEOUT_S,
      hooks: [
        async (input) => {
          if (input.hook_event_name !== "PostToolBatch" || input.agent_id) return {};
          let text: string | null;
          try {
            text = take();
          } catch {
            return {};
          }
          if (!text) return {};
          return {
            hookSpecificOutput: {
              hookEventName: "PostToolBatch",
              additionalContext: text,
            },
          };
        },
      ],
    },
  ];
}

export const CLAUDE_MEMORY_OFF_SETTINGS: Extract<Options["settings"], object> = {
  autoMemoryEnabled: false,
};

export const CLAUDE_LAUNCH_SETTINGS: Extract<Options["settings"], object> = {
  ...CLAUDE_MEMORY_OFF_SETTINGS,
  env: { DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1" },
};

function claudeModelForEnvironment(modelFamily: string, env: { [key: string]: string | undefined } | undefined): string {
  if (isClaudeCloudSelected(env)) return modelFamily;
  return FAMILY_TO_MODEL[modelFamily as ModelFamily] ?? modelFamily;
}

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
      model: claudeModelForEnvironment(opts.modelFamily, opts.env),
      permissionMode: opts.permissionMode as Options["permissionMode"],
      pathToClaudeCodeExecutable: CLAUDE_NATIVE_BIN,
      systemPrompt: { type: "preset", preset: "claude_code", append: opts.systemPrompt },
      cwd: opts.cwd,
      hooks: opts.takeToolBoundaryMessage
        ? ({
            ...createSafetyHooks(),
            PostToolBatch: toolBoundaryHooks(opts.takeToolBoundaryMessage),
          } as Partial<Record<HookEvent, HookCallbackMatcher[]>>)
        : createSafetyHooks(),
      settings: CLAUDE_LAUNCH_SETTINGS,
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
  toolBoundaryDelivery: true,
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
  async forkSessionBeforeMessage(sessionId, targetMessageId, access): Promise<ForkSessionBeforeMessageResult> {
    const cwd = access?.cwd ?? process.cwd();
    const sdkOptions: GetSessionMessagesOptions & ForkSessionOptions = {
      dir: cwd,
      sessionStore: claudeSessionStore(sessionId, cwd, access?.env),
    };
    const result = await sdkForkSession(sessionId, { upToMessageId: targetMessageId, ...sdkOptions });
    return { kind: "fork", sessionId: result.sessionId, forkedFromSessionId: sessionId };
  },
  async getSessionMessages(sessionId, cwd, access): Promise<NormalizedMessage[]> {
    const actualCwd = access?.cwd ?? cwd;
    const messages = await sdkGetSessionMessages(sessionId, {
      dir: actualCwd,
      sessionStore: claudeSessionStore(sessionId, actualCwd, access?.env),
    });
    return messages.map((m: any) => ({
      uuid: m.uuid,
      role: m.type === "user" ? "user" : m.type === "assistant" ? "assistant" : m.type === "result" ? "result" : "system",
      text: extractMessageText(m),
    }));
  },
  async oneShotPrompt(prompt: string, opts: OneShotOptions): Promise<string> {
    const result = await runClaudeOneShot(prompt, {
      model: claudeModelForEnvironment(opts.modelFamily, opts.env),
      ...(opts.systemPrompt ? { systemPrompt: opts.systemPrompt } : {}),
      settings: CLAUDE_LAUNCH_SETTINGS,
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
