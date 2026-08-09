// Codex backend session.
//
// Implements the Backend / BackendSession contracts (server/backends/types.ts)
// against the Codex App Server's JSON-RPC lite protocol via the
// JsonRpcLiteClient in ./client.ts. One CodexSession owns one threadId and
// one subprocess for v1 — symmetric with Claude. The client layer is built so
// a future shared-subprocess deployment can swap in without touching this
// adapter (subscribers filter by threadId from day one).
//
// Critical invariants this code maintains (per the Codex Expert's review):
//
//   1. Exactly one turn_completed NormalizedEvent per send(). Codex emits one
//      turn/completed per turn (Completed or Failed); turn/interrupted maps
//      to status:"interrupted". Subprocess death mid-turn synthesizes a
//      failed turn_completed so the orchestrator's pendingTurn unblocks.
//
//   2. Per-thread filtering. Every codex notification with a threadId is
//      filtered against this session's threadId. Sub-agent / review-mode
//      child threads have their own ids and must never resolve our turn.
//
//   3. experimentalApi: true at initialize. We generated schemas with
//      --experimental, so missing this flag would silently strip experimental
//      fields on the wire.

import { errMessage } from "../../../shared/errors.ts";
import { BackendNotConfiguredError } from "../../internal-types.ts";

import type { ApprovalDecision, AttachmentSpec, BackendSession, NormalizedEvent, SubscriptionUsageResult } from "../types.ts";
import type { GetAccountRateLimitsResponse } from "./_generated/v2/GetAccountRateLimitsResponse.ts";

import { JsonRpcLiteClient, type JsonRpcLiteClientOptions, type JsonRpcNotification, type JsonRpcRequest } from "./client.ts";
import { buildCodexUserInput } from "./user-input.ts";
import { CodexRateLimitTracker } from "./session-rate-limits.ts";
import { CodexUsageTracker } from "./session-usage.ts";
import { CodexAuthSignalGate } from "./session-auth-gate.ts";
import { rejectPendingApprovalsOnClose, resolvePendingApprovalsOnAbort } from "./session-approval-cleanup.ts";
import { attachmentFromPath } from "./session-attachments.ts";
import { bootstrapCodexThread, type CodexSessionInitOpts } from "./session-bootstrap.ts";
import { CodexSessionEventBuffer } from "./session-event-buffer.ts";
import { handleCodexNotification } from "./session-notifications.ts";
import { codexSubprocessExitEvent, handleCodexSessionStderr } from "./session-process-events.ts";
import { handleCodexServerRequest, type PendingApproval } from "./session-requests.ts";
import { SessionPrefixRules } from "./prefix-rules.ts";
import { answerPendingApproval } from "./session-answer-approval.ts";
import { startCodexTurn } from "./session-turn-start.ts";

// ---------------------------------------------------------------------------
// CodexSession
// ---------------------------------------------------------------------------
//
// State machine:
//
//   constructor()
//        │  (spawn subprocess; start bootstrap)
//        ▼
//   INITIALIZING ──── initialize() + thread/start ────► READY (system_init emitted)
//        │                                                  │
//        │                                                  │  send()/approve()/abort()
//        ▼                                                  │
//      CLOSED  ◄──────── close() ────────────────────────── │
//
// While INITIALIZING, send/approve/abort calls queue or reject (we just
// reject — orchestrator-level state prevents calls until system_init lands).
//
// Stream output is buffered exactly like ClaudeSession: enqueue + wake the
// stream's parked promise; stream() yields from buffer.

export class CodexSession implements BackendSession {
  private client: JsonRpcLiteClient;
  private threadId: string | null = null;
  private activeTurnId: string | null = null;
  private events = new CodexSessionEventBuffer();
  private closed = false;
  // Tracks whether we've yielded turn_completed for the current turn so we
  // can synthesize a failed one on subprocess exit if not.
  private turnInFlight = false;
  private authGate = new CodexAuthSignalGate();
  // jsonRpcId-keyed map of in-flight server-initiated approval requests. The
  // orchestrator references these by approvalId == jsonRpcId.
  private pendingApprovals = new Map<string, PendingApproval>();
  // Command prefixes the user chose to stop being asked about this session.
  // A plain field: the store is in-memory and per-session by design, so it
  // dies with this object (/clear, resume, restart, session swap) and no other
  // agent can see it. See prefix-rules.ts for why codex's own
  // acceptWithExecpolicyAmendment is never sent instead.
  private prefixRules = new SessionPrefixRules();
  private usage = new CodexUsageTracker();
  private rateLimits = new CodexRateLimitTracker();
  // Resolves when bootstrap (initialize + thread/start) completes — success
  // or failure. send() / approve() / abort() await this so they don't race
  // the async setup. On failure threadId stays null; callers see a clear
  // "bootstrap failed" error instead of "not initialized yet."
  private bootstrapPromise: Promise<void>;
  // Captured at bootstrap-failure time, re-thrown by send() on the
  // first user message attempt so the actionable error (install hint,
  // auth failure, etc.) lands in chat AND transitions the agent to
  // error state THEN — matches Claude's lazy-auth UX where the agent
  // looks idle from spawn until the user actually messages it.
  private bootstrapError: Error | null = null;

  constructor(private readonly opts: CodexSessionInitOpts) {
    // JsonRpcLiteClient.start() applies the bureau CODEX_HOME default so
    // every codex subprocess (session bootstrap + listModels + oneShot +
    // fork + read) spawns under the same effective env. Per-user envFile
    // CODEX_HOME (see internal-docs/isolation-design.md) is honored
    // verbatim by withBureauCodexHome.
    const clientOpts: JsonRpcLiteClientOptions = {
      cwd: opts.cwd,
      env: opts.env,
    };
    this.client = new JsonRpcLiteClient(clientOpts);
    this.client.onStderr((chunk) => this.handleStderr(chunk));
    this.client.onNotification((n) => this.handleNotification(n));
    this.client.onServerRequest((req) => this.handleServerRequest(req));
    this.client.onExit((code, signal) => this.handleSubprocessExit(code, signal));
    this.bootstrapPromise = this.bootstrap();
  }

  // -------------------------------------------------------------------------
  // Bootstrap: spawn → initialize → thread/start → emit system_init
  // -------------------------------------------------------------------------

  private async bootstrap(): Promise<void> {
    try {
      this.client.start();
      this.threadId = await bootstrapCodexThread(this.client, this.opts);

      this.enqueue({
        kind: "system_init",
        sessionId: this.threadId,
        slashCommands: [],
        model: this.opts.modelFamily,
      });
    } catch (err) {
      // Defer the error to send(): we want this agent to look idle from
      // spawn so the desk indicator doesn't go red before the user has
      // even tried it (Claude's auth-failure UX is the reference). Emit
      // system_init so the orchestrator transitions us to idle instead
      // of leaving the agent in pre-init; sessionId is unused for a
      // never-started thread (nothing to persist, nothing to resume).
      this.bootstrapError = err instanceof Error ? err : new Error(errMessage(err));
      this.enqueue({
        kind: "system_init",
        sessionId: "",
        slashCommands: [],
        model: this.opts.modelFamily,
      });
      this.markEnded();
    }
  }

  // -------------------------------------------------------------------------
  // BackendSession surface
  // -------------------------------------------------------------------------

  async *stream(): AsyncGenerator<NormalizedEvent, void> {
    yield* this.events.stream();
  }

  async send(text: string, attachments?: AttachmentSpec[]): Promise<void> {
    // Wait for bootstrap (initialize + thread/start) to finish so callers
    // who fire send() immediately after a session swap don't race. After
    // bootstrap, threadId is either set (success) or still null (bootstrap
    // failed — the orchestrator already saw the `error` event from
    // bootstrap and routed it; raising here surfaces the same condition to
    // the awaiting sendMessage / flushQueue caller).
    await this.bootstrapPromise;
    if (this.closed) throw new Error("CodexSession.send: session is closed");
    if (!this.threadId) {
      // Bootstrap failed — wrap the captured error in BackendNotConfiguredError
      // so sendMessage / flushQueue / editMessage know to surface this calmly
      // (system log entry, agent stays idle) rather than as a real turn error
      // that flips the agent to error state. The actionable text (auth prompt,
      // bundled-binary missing hint, etc.) is already in bootstrapError.message
      // and gets surfaced verbatim — no "Error:" wrapping.
      throw new BackendNotConfiguredError(this.bootstrapError?.message ?? "Codex bootstrap failed; cannot send");
    }

    const input = buildCodexUserInput(text, attachments, this.opts.agentId);
    // Only flip turnInFlight after turn/start succeeds. If the request throws
    // (e.g. wire error) we don't want handleSubprocessExit to later synthesize
    // a phantom failed turn_completed for a turn that never actually started
    // — the orchestrator would surface a bogus mid-turn failure.
    await startCodexTurn({
      client: this.client,
      threadId: this.threadId,
      input,
      authGate: this.authGate,
      enqueueAuthAwareSystemText: (message) => this.enqueueAuthAwareSystemText(message),
    });
    this.turnInFlight = true;
  }

  async approve(approvalId: string, decision: ApprovalDecision): Promise<void> {
    await this.bootstrapPromise;
    answerPendingApproval({
      pendingApprovals: this.pendingApprovals,
      prefixRules: this.prefixRules,
      approvalId,
      decision,
      enqueue: (event) => this.enqueue(event),
    });
  }

  async abort(): Promise<void> {
    await this.bootstrapPromise;
    if (this.closed) return;
    if (!this.threadId || !this.activeTurnId) {
      // Nothing to interrupt — no in-flight turn (either bootstrap failed
      // or no send happened yet).
      return;
    }
    try {
      await this.client.request("turn/interrupt", {
        threadId: this.threadId,
        turnId: this.activeTurnId,
      });
    } catch (err) {
      this.enqueue({
        kind: "system_text",
        text: `Codex interrupt failed: ${errMessage(err)}`,
      });
    }
    resolvePendingApprovalsOnAbort(this.pendingApprovals);
  }

  canAbortInPlace(): boolean {
    return !this.closed && this.threadId !== null && this.activeTurnId !== null;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    rejectPendingApprovalsOnClose(this.client, this.pendingApprovals);
    // Fire-and-forget close on the client; subprocess exit handler tidies up.
    void this.client.close();
    this.markEnded();
  }

  async getContextUsage() {
    return this.usage.getContextUsage(this.opts.modelFamily);
  }

  // Plan allowance for the signed-in ChatGPT account. Served from the pushed
  // rate-limit cache; the read below only covers the pre-push gap.
  async getSubscriptionUsage(): Promise<SubscriptionUsageResult> {
    return this.rateLimits.read(async () => {
      await this.bootstrapPromise;
      if (this.closed || this.bootstrapError) return null;
      return this.client.request<GetAccountRateLimitsResponse>("account/rateLimits/read");
    });
  }

  // -------------------------------------------------------------------------
  // Buffer / wake helpers
  // -------------------------------------------------------------------------

  private enqueue(ev: NormalizedEvent): void {
    this.events.enqueue(ev);
  }

  private enqueueAuthAwareSystemText(text: string): void {
    this.authGate.enqueueAuthAwareSystemText(text, {
      threadId: this.threadId,
      activeTurnId: this.activeTurnId,
      client: this.client,
      enqueue: (event) => this.enqueue(event),
    });
  }

  private markEnded(): void {
    this.events.markEnded();
  }

  // -------------------------------------------------------------------------
  // Notification routing
  // -------------------------------------------------------------------------

  private handleNotification(n: JsonRpcNotification): void {
    handleCodexNotification(n, {
      threadId: this.threadId,
      selfInterruptedForAuth: this.authGate.selfInterruptedForAuth,
      authSignalEmittedThisTurn: this.authGate.authSignalEmittedThisTurn,
      usage: this.usage,
      rateLimits: this.rateLimits,
      setActiveTurnId: (turnId) => {
        this.activeTurnId = turnId;
      },
      clearTurnInFlight: () => {
        this.turnInFlight = false;
      },
      resetAuthTurnState: () => {
        this.authGate.resetTurn();
      },
      enqueue: (event) => this.enqueue(event),
      enqueueAuthAwareSystemText: (text) => this.enqueueAuthAwareSystemText(text),
      attachmentFromPath: (rawPath) => attachmentFromPath(this.opts.agentId, rawPath),
    });
  }

  // -------------------------------------------------------------------------
  // Server-initiated request routing
  // -------------------------------------------------------------------------

  private async handleServerRequest(req: JsonRpcRequest): Promise<unknown> {
    return handleCodexServerRequest(req, {
      threadId: this.threadId,
      pendingApprovals: this.pendingApprovals,
      prefixRules: this.prefixRules,
      enqueue: (event) => this.enqueue(event),
    });
  }

  // -------------------------------------------------------------------------
  // Stderr + subprocess exit
  // -------------------------------------------------------------------------

  private handleStderr(chunk: string): void {
    handleCodexSessionStderr(chunk, (text) => this.enqueueAuthAwareSystemText(text));
  }

  private handleSubprocessExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.closed) return;
    // The per-turn auth-coalescing gate must close on subprocess death so an
    // unlikely-but-possible later stderr (e.g. drained late) doesn't sneak
    // through with a stale-open gate.
    this.authGate.resetTurn();
    this.enqueue(codexSubprocessExitEvent({ code, signal, turnInFlight: this.turnInFlight }));
    this.turnInFlight = false;
    this.markEnded();
  }
}
