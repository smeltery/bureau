// Codex backend session.

import { errMessage } from "../../../shared/errors.ts";
import { BackendNotConfiguredError } from "../../internal-types.ts";

import type { ApprovalDecision, AttachmentSpec, BackendSession, NormalizedEvent, SubagentOrigin, SubscriptionUsageResult } from "../types.ts";
import type { GetAccountRateLimitsResponse } from "./_generated/v2/GetAccountRateLimitsResponse.ts";

import { JsonRpcLiteClient, type JsonRpcLiteClientOptions, type JsonRpcNotification, type JsonRpcRequest } from "./client.ts";
import { buildCodexUserInput } from "./user-input.ts";
import { CodexRateLimitTracker } from "./session-rate-limits.ts";
import { CodexUsageTracker } from "./session-usage.ts";
import { CodexAuthSignalGate } from "./session-auth-gate.ts";
import { rejectPendingApprovalsOnClose, resolvePendingApprovalsOnAbort } from "./session-approval-cleanup.ts";
import { bootstrapCodexThread, type CodexSessionInitOpts } from "./session-bootstrap.ts";
import { CodexSessionEventBuffer } from "./session-event-buffer.ts";
import { codexSubprocessExitEvent, handleCodexSessionStderr } from "./session-process-events.ts";
import { handleCodexServerRequest, type PendingApproval } from "./session-requests.ts";
import { SessionPrefixRules } from "./prefix-rules.ts";
import { answerPendingApproval } from "./session-answer-approval.ts";
import { startCodexTurn } from "./session-turn-start.ts";
import { CodexCapacityRetry } from "./session/capacity-retry.ts";
import { routeCodexNotification } from "./session/notification-router.ts";

export class CodexSession implements BackendSession {
  private client: JsonRpcLiteClient;
  private threadId: string | null = null;
  private activeTurnId: string | null = null;
  private events = new CodexSessionEventBuffer();
  private closed = false;
  // Tracks whether we've yielded turn_completed for the current turn so we
  // can synthesize a failed one on subprocess exit if not.
  private turnInFlight = false;
  // Covers turn/start before turnInFlight may safely arm subprocess-exit synthesis.
  private turnStarting = false;
  // Codex can deliver completed tool items after turn/completed.
  private lateToolResultNoticeEmitted = false;
  private lateToolResultNoticeArmed = false;
  private authGate = new CodexAuthSignalGate();
  private readonly missingToolOutputNotices = new Set<string>();
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
  private capacityRetry = new CodexCapacityRetry(
    (delayMs, run) => this.scheduleCapacityRetry(delayMs, run),
    (event) => this.enqueue(event),
  );
  // Child threads spawned by this Codex thread. Known child-thread tool items
  // are surfaced as subagent tool activity; their turn lifecycle and prose are
  // still filtered out so parent bookkeeping stays isolated.
  private childThreads = new Map<string, SubagentOrigin>();
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
    this.capacityRetry.resetTurn();
    // Only flip turnInFlight after turn/start succeeds. If the request throws
    // (e.g. wire error) we don't want handleSubprocessExit to later synthesize
    // a phantom failed turn_completed for a turn that never actually started
    // — the orchestrator would surface a bogus mid-turn failure.
    this.turnStarting = true;
    try {
      await startCodexTurn({
        client: this.client,
        threadId: this.threadId,
        input,
        authGate: this.authGate,
        enqueueAuthAwareSystemText: (message) => this.enqueueAuthAwareSystemText(message),
      });
    } catch (err) {
      this.turnStarting = false;
      throw err;
    }
    this.turnInFlight = true;
    this.turnStarting = false;
    this.lateToolResultNoticeEmitted = false;
    this.lateToolResultNoticeArmed = false;
  }

  private scheduleCapacityRetry(delayMs: number, run: () => void): () => void {
    if (this.opts.scheduleRetry) return this.opts.scheduleRetry(delayMs, run);
    const timer = setTimeout(run, delayMs);
    return () => clearTimeout(timer);
  }

  private finishCapacityBackoff(status: "interrupted" | "failed", error: string): boolean {
    if (!this.capacityRetry.finishBackoff(status, error)) return false;
    this.turnInFlight = false;
    this.turnStarting = false;
    this.activeTurnId = null;
    return true;
  }

  private retryCapacityTurn(delayMs: number): void {
    this.capacityRetry.retryAsync(
      delayMs,
      () => {
        if (!this.threadId) return Promise.resolve();
        this.turnStarting = true;
        return this.client.request("turn/start", { threadId: this.threadId, input: [] });
      },
      () => {
        if (this.closed || !this.threadId) return;
        this.turnStarting = false;
        this.turnInFlight = true;
        this.lateToolResultNoticeEmitted = false;
        this.lateToolResultNoticeArmed = false;
      },
      (err) => {
        this.turnStarting = false;
        this.turnInFlight = false;
        this.enqueue({ kind: "turn_completed", status: "failed", error: errMessage(err) });
      },
    );
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
    if (this.finishCapacityBackoff("interrupted", "Provider-capacity retry interrupted.")) return;
    await this.bootstrapPromise;
    if (this.closed) return;
    if (!this.threadId || !this.activeTurnId) {
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
    return !this.closed && this.threadId !== null && (this.activeTurnId !== null || this.capacityRetry.hasPendingRetry);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.finishCapacityBackoff("failed", "Codex session closed during provider-capacity backoff.");
    rejectPendingApprovalsOnClose(this.client, this.pendingApprovals);
    void this.client.close();
    this.markEnded();
  }

  async getContextUsage() {
    return this.usage.getContextUsage(this.opts.modelFamily);
  }

  async getSubscriptionUsage(): Promise<SubscriptionUsageResult> {
    return this.rateLimits.read(async () => {
      await this.bootstrapPromise;
      if (this.closed || !this.threadId) return null;
      if (this.bootstrapError) return null;
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
    routeCodexNotification(this, n);
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
    handleCodexSessionStderr(chunk, this.missingToolOutputNotices, (text) => this.enqueueAuthAwareSystemText(text));
  }

  private handleSubprocessExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.closed) return;
    if (this.finishCapacityBackoff("failed", `codex subprocess exited${code != null ? ` (code ${code})` : ""}${signal ? ` (signal ${signal})` : ""} during provider-capacity backoff`)) {
      return;
    }
    // The per-turn auth-coalescing gate must close on subprocess death so an
    // unlikely-but-possible later stderr (e.g. drained late) doesn't sneak
    // through with a stale-open gate.
    this.authGate.resetTurn();
    this.enqueue(codexSubprocessExitEvent({ code, signal, turnInFlight: this.turnInFlight }));
    this.turnInFlight = false;
    this.markEnded();
  }
}
