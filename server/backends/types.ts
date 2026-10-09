// Backend abstraction shared by Claude (claude-agent-sdk), Codex (App Server),
// and OpenCode (local `opencode serve` HTTP/SSE).
//
// agent-manager.ts holds runConsumer / queue / abort / fork / topic-gen / etc.
// in backend-agnostic form; engines implement this contract under
// server/backends/{claude,codex,opencode}/ and the dispatch lives in
// server/backends/index.ts (`getBackend(agentType)`).
//
// All session-lifecycle methods (`createSession`, `resumeSession`) are
// synchronous to mirror the Claude SDK's current shape — backends defer
// any handshake (Codex `initialize` / first `thread/started`) and surface
// the assigned id via the first `system_init` NormalizedEvent on the stream.

// ---------------------------------------------------------------------------
// Capabilities
// ---------------------------------------------------------------------------
// Static per-backend, embedded in the agent payload sent to the UI. The UI
// hides affordances when a capability is false (e.g. greys out the "branch"
// button on a backend without fork support). The wire shape lives in
// shared/types.ts as AgentCapabilities; this is just an alias so backend
// code reads naturally.

import type { AgentCapabilities } from "../../shared/types.ts";
import type { BackendSession, NormalizedMessage } from "./session-types.ts";
export type {
  ApprovalDecision,
  AttachmentSpec,
  BackendSession,
  ContextUsage,
  NormalizedEvent,
  NormalizedMessage,
  // Re-exported so backend code can name it without reaching into shared/. The
  // wire/disk shape lives there because it travels as LogEntry.metadata.subagent.
  SubagentOrigin,
  SubscriptionUsage,
  SubscriptionUsageResult,
  SubscriptionUsageWindow,
  TokenUsage,
} from "./session-types.ts";
export type BackendCapabilities = AgentCapabilities;

// ---------------------------------------------------------------------------
// createSession / resumeSession options
// ---------------------------------------------------------------------------
// The orchestrator pre-builds the system prompt and resolves env vars before
// handing off — so backends don't need to know about office/room/user state.
// `modelFamily`, `effort`, and `permissionMode` are deliberately untyped at
// this layer: each backend's `getModelOptions()` / `getPermissionModes()`
// defines its own value space (Claude: opus/sonnet/haiku × default/acceptEdits/
// bypassPermissions/auto; Codex: gpt-5 family × sandbox × approvalPolicy).

export interface CreateSessionOptions {
  agentId: string;
  cwd: string;
  systemPrompt: string;
  modelFamily: string;
  effort: string;
  permissionMode: string;
  // Codex-only: SandboxMode string ("read-only" / "workspace-write" /
  // "danger-full-access"). Claude backend ignores. Undefined falls back to
  // the backend's default ("workspace-write" for Codex).
  sandbox?: string;
  env?: { [key: string]: string | undefined };
  takeToolBoundaryMessage?: () => string | null;
}

// ---------------------------------------------------------------------------
// Backend — engine-level metadata + session factory
// ---------------------------------------------------------------------------

export interface ModelOption {
  value: string; // backend-specific (Claude: "opus"; Codex: "gpt-5")
  label: string; // UI label
}

export interface PermissionModeOption {
  value: string; // backend-specific value
  label: string; // UI label
}

export interface OneShotOptions {
  // Working directory. Used by Codex (sandbox + RPC client) but ignored by
  // the Claude backend, which forces a neutral cwd internally so caller-cwd
  // context (git status, CLAUDE.md autoload) can't leak into the response.
  cwd?: string;
  modelFamily: string;
  systemPrompt?: string;
  env?: { [key: string]: string | undefined };
}

export interface ListModelsOptions {
  cwd: string;
  env?: { [key: string]: string | undefined };
  includeHidden?: boolean;
}

export interface SessionAccessOptions {
  cwd: string;
  env?: { [key: string]: string | undefined };
}

// Per-model effort option as reported by the backend. Codex's
// ReasoningEffortOption maps directly; backends that don't expose
// per-model efforts can return an empty array.
export interface BackendEffortOption {
  level: string;
  description?: string;
}

// Backend-reported model entry. Shape is intentionally lean — UI uses
// `id` as the wire value (matches CreateSessionOptions.modelFamily) and
// `label` for display. `supportedEfforts` re-renders the effort picker
// per model; `defaultEffort` is the model's preferred effort and is used
// as the snap-to value when the current effort isn't supported.
export interface BackendModel {
  id: string;
  label: string;
  description?: string;
  isDefault?: boolean;
  hidden?: boolean;
  supportedEfforts: BackendEffortOption[];
  supportsAutoPermission?: boolean;
  defaultEffort?: string;
}

// Result of forkSessionBeforeMessage. Backends choose between producing a
// real linked branch (kind: "fork", with the parent sessionId as
// forkedFromSessionId) and a fresh unrelated session (kind: "fresh", no
// sessionId yet — the orchestrator creates the session and waits for
// system_init to fill the id, just like newConversation). agent-manager
// branches on `kind`: fork → createSession(managed, sessionId) +
// persistSessionFork; fresh → createSession(managed) + skip fork metadata.
export type ForkSessionBeforeMessageResult = { kind: "fork"; sessionId: string; forkedFromSessionId: string } | { kind: "fresh" };

export interface Backend {
  readonly capabilities: BackendCapabilities;
  readonly toolBoundaryDelivery?: boolean;

  getModelOptions(): ModelOption[];
  getPermissionModes(): PermissionModeOption[];

  // Fetch the auth-appropriate model list from the underlying backend. For
  // Codex this calls `model/list` over the JSON-RPC App Server; for backends
  // without a runtime model API this returns the static getModelOptions()
  // shape promoted to BackendModel. Throws on auth failure or transport
  // error — caller is responsible for surfacing.
  listModels(opts: ListModelsOptions): Promise<BackendModel[]>;

  createSession(opts: CreateSessionOptions): BackendSession;
  resumeSession(sessionId: string, opts: CreateSessionOptions): BackendSession;
  checkSessionResumable(sessionId: string, opts: SessionAccessOptions): string | null;

  // Branch a conversation so that `targetMessageId` and everything after it
  // is replaced. The backend resolves predecessor / first-message semantics
  // internally — agent-manager just passes the edited message's id.
  //   - Claude: middle → SDK forkSession at predecessor; first → fresh session
  //   - Codex: thread/fork parent + thread/rollback child to before target's
  //     turn (always linked, including first-message — gives /resume parity)
  forkSessionBeforeMessage(sessionId: string, targetMessageId: string, access?: SessionAccessOptions): Promise<ForkSessionBeforeMessageResult>;
  getSessionMessages(sessionId: string, cwd: string, access?: SessionAccessOptions): Promise<NormalizedMessage[]>;

  // Single-prompt operation used by topic generation. Returns the assistant
  // text. Throws on failure.
  oneShotPrompt(prompt: string, opts: OneShotOptions): Promise<string>;

  // Inspect a thrown / surfaced error string for known auth-failure signals.
  detectAuthError(text: string): boolean;

  // User-facing instructions for re-authenticating. `text` is surfaced as a
  // system log entry after an auth-error is detected; each entry in
  // `commands`, when present, is emitted as an adjacent terminal-command card
  // the user can click to copy into the built-in terminal. Multiple commands
  // render as a stack of cards in the order returned — backends that surface
  // alternatives (e.g. Codex browser OAuth vs `--device-auth` for remote
  // hosts) use this to give the user a side-by-side pick.
  //
  // `opts.env` carries the agent's resolved spawn env (process.env + office
  // envFile + user envFile, in that override order). Backends that detect
  // env-var auth (e.g. Codex's OPENAI_API_KEY) check it to avoid telling a
  // user to "sign in" when their envFile already authenticates them.
  getLoginInstructions(opts?: { env?: { [key: string]: string | undefined } }): { text: string; commands?: string[] } | Promise<{ text: string; commands?: string[] }>;
}
