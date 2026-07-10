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

import { readFileSync, statSync } from "fs";
import { basename } from "path";

import { saveFile } from "../../persistence.ts";
import { mimeTypeForFilename } from "../../mime-types.ts";
import { errMessage } from "../../../shared/errors.ts";
import { BackendNotConfiguredError } from "../../internal-types.ts";

import type { ApprovalDecision, AttachmentSpec, BackendSession, NormalizedEvent } from "../types.ts";

import { JsonRpcLiteClient, type JsonRpcLiteClientOptions, type JsonRpcNotification, type JsonRpcRequest } from "./client.ts";
import { mapApprovalDecision } from "./approvals.ts";
import { buildCodexUserInput } from "./user-input.ts";
import { AUTH_ERROR_PATTERNS } from "./config.ts";
import { CodexUsageTracker } from "./session-usage.ts";
import { bootstrapCodexThread, type CodexSessionInitOpts } from "./session-bootstrap.ts";
import { handleCodexNotification } from "./session-notifications.ts";
import { handleCodexServerRequest, type PendingApproval } from "./session-requests.ts";

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
  private buffer: NormalizedEvent[] = [];
  private resolveWake: (() => void) | null = null;
  private ended = false;
  private closed = false;
  // Tracks whether we've yielded turn_completed for the current turn so we
  // can synthesize a failed one on subprocess exit if not.
  private turnInFlight = false;
  // Auth-error coalescing for codex stderr. Codex CLI internally retries the
  // OpenAI websocket 5+ times on 401 with exponential backoff, emitting one
  // `ERROR ... 401 Unauthorized` stderr line per retry. Forwarding each one
  // as system_text triggers the auth-detect path in agent-manager on every
  // line and pastes the sign-in card repeatedly — what task 5811bae6
  // described as the "infinite loop" UX. Symmetric with the Claude SDK,
  // which emits at most one auth signal per send: gate auth-shaped stderr
  // to one signal per user-initiated turn (`authSignalsAllowedThisTurn`
  // opens before turn/start in send(), closes on turn/completed or send
  // failure; `authSignalEmittedThisTurn` is the once-per-turn latch).
  // Pre-turn stderr (codex's startup websocket pre-warm) is silenced.
  private authSignalsAllowedThisTurn = false;
  private authSignalEmittedThisTurn = false;
  // Set when we ourselves issue turn/interrupt to short-circuit codex's
  // ~12s websocket retry budget on a doomed-by-auth turn. The natural
  // turn/completed from codex will land with status="interrupted"; the
  // turn/completed handler maps it back to status="failed" + the standard
  // auth summary so the user sees a clear failure, not a vague "interrupted".
  private selfInterruptedForAuth = false;
  // jsonRpcId-keyed map of in-flight server-initiated approval requests. The
  // orchestrator references these by approvalId == jsonRpcId.
  private pendingApprovals = new Map<string, PendingApproval>();
  private usage = new CodexUsageTracker();
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
    while (true) {
      while (this.buffer.length > 0) {
        yield this.buffer.shift()!;
      }
      if (this.ended) return;
      await new Promise<void>((resolve) => {
        this.resolveWake = resolve;
      });
    }
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
    // Open the auth-stderr gate before turn/start. The gate must be open
    // during turn/start's await window because codex's websocket retry burst
    // can land on stderr before the RPC returns. If turn/start itself throws,
    // close the gate so subsequent unsolicited codex stderr stays silent.
    this.authSignalsAllowedThisTurn = true;
    this.authSignalEmittedThisTurn = false;
    // Only flip turnInFlight after turn/start succeeds. If the request throws
    // (e.g. wire error) we don't want handleSubprocessExit to later synthesize
    // a phantom failed turn_completed for a turn that never actually started
    // — the orchestrator would surface a bogus mid-turn failure.
    try {
      await this.client.request("turn/start", {
        threadId: this.threadId,
        input,
      });
    } catch (err) {
      // If turn/start itself rejects with an auth-shaped error (a future
      // codex revision could pre-check auth before accepting the turn),
      // emit the same single auth signal we'd emit from stderr so the
      // user still gets the sign-in card. Without this, flushQueue's
      // generic catch logs "Error flushing queue: ..." with no auth
      // detection and the login card is lost on this code path. The
      // helper enforces the once-per-turn latch; the post-throw clears
      // also close the gate so any remaining auth-shaped notification
      // for this dead turn stays silent.
      const message = errMessage(err);
      if (AUTH_ERROR_PATTERNS.test(message)) {
        this.enqueueAuthAwareSystemText(`Codex auth error during turn start: ${message}`);
      }
      this.authSignalsAllowedThisTurn = false;
      this.authSignalEmittedThisTurn = false;
      this.selfInterruptedForAuth = false;
      throw err;
    }
    this.turnInFlight = true;
  }

  async approve(approvalId: string, decision: ApprovalDecision): Promise<void> {
    await this.bootstrapPromise;
    const pending = this.pendingApprovals.get(approvalId);
    if (!pending) return;
    this.pendingApprovals.delete(approvalId);
    const decisionWire = mapApprovalDecision(pending.method, decision);
    // Resolving the deferred releases the JsonRpcLiteClient's handler-chain
    // await; the client auto-responds with this payload. (Previously we
    // called client.respond() directly while leaving the promise pending,
    // which leaked one parked handler frame per approval.) The enum variant
    // set differs per method — see mapApprovalDecision for the routing.
    pending.resolve({ decision: decisionWire });
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
    // Release any in-flight server-initiated approval requests so the parked
    // JsonRpcLiteClient handler frames don't leak across to the next turn.
    // close() can use respondWithError because client.close() runs synchronously
    // right after and short-circuits the deferred-rejection's auto-respond — the
    // hot-abort path doesn't close the client, so we must resolve cleanly to
    // avoid double-responding on the wire (one -32000, then a -32603 from the
    // catch in JsonRpcLiteClient.handleServerRequest). Routing through
    // mapApprovalDecision keeps the wire shape identical to a user-driven deny.
    for (const [, pending] of this.pendingApprovals) {
      try {
        const decisionWire = mapApprovalDecision(pending.method, {
          kind: "deny",
          reason: "Turn interrupted",
        });
        pending.resolve({ decision: decisionWire });
      } catch {}
    }
    this.pendingApprovals.clear();
  }

  canAbortInPlace(): boolean {
    return !this.closed && this.threadId !== null && this.activeTurnId !== null;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // Tell codex about in-flight approvals before tearing down. Respond on
    // the wire FIRST: the deferred rejection below would also trigger an
    // auto-respond, but by the time that fires we've called client.close()
    // and the response is dropped — so the explicit respondWithError is what
    // codex actually sees. Then reject the deferred so the parked handler
    // frame unwinds and the promise frees.
    for (const [, pending] of this.pendingApprovals) {
      try {
        this.client.respondWithError(pending.jsonRpcId, -32000, "Session closed");
      } catch {}
      try {
        pending.reject(new Error("Session closed"));
      } catch {}
    }
    this.pendingApprovals.clear();
    // Fire-and-forget close on the client; subprocess exit handler tidies up.
    void this.client.close();
    this.markEnded();
  }

  async getContextUsage() {
    return this.usage.getContextUsage(this.opts.modelFamily);
  }

  // -------------------------------------------------------------------------
  // Buffer / wake helpers
  // -------------------------------------------------------------------------

  private enqueue(ev: NormalizedEvent): void {
    this.buffer.push(ev);
    this.wake();
  }

  // Funnel for system_text emissions whose payload may carry codex-sourced
  // text (stderr, advisory notifications, error messages). Applies the
  // per-turn auth-coalescing gate so any auth-shaped string — regardless of
  // which codex path produced it — counts as the one allowed signal per
  // user-initiated turn. Hardcoded system_text (image notices, model-not-
  // supported, auto-declined cards, etc.) bypasses this helper because we
  // know its content is safe.
  private enqueueAuthAwareSystemText(text: string): void {
    if (AUTH_ERROR_PATTERNS.test(text)) {
      if (!this.authSignalsAllowedThisTurn) return;
      if (this.authSignalEmittedThisTurn) return;
      this.authSignalEmittedThisTurn = true;
      // Short-circuit codex's websocket retry budget. The retries are doomed,
      // and without an interrupt the agent sits in "thinking" for ~12s
      // before turn/completed lands — misleading UX (the model never ran).
      this.requestSelfInterruptForAuth();
    }
    this.enqueue({ kind: "system_text", text });
  }

  // Fire-and-forget turn/interrupt when an auth signal latches. Best-effort:
  // if activeTurnId hasn't been observed yet (turn/started notification
  // hasn't arrived) or codex doesn't honor the interrupt, we fall back to
  // the natural ~12s retry-exhaustion timer.
  private requestSelfInterruptForAuth(): void {
    if (this.selfInterruptedForAuth) return;
    if (!this.threadId || !this.activeTurnId) return;
    this.selfInterruptedForAuth = true;
    this.client
      .request("turn/interrupt", {
        threadId: this.threadId,
        turnId: this.activeTurnId,
      })
      .catch(() => {});
  }

  private attachmentFromPath(rawPath: unknown): AttachmentSpec | null {
    if (typeof rawPath !== "string" || rawPath.length === 0) return null;
    try {
      const st = statSync(rawPath);
      if (!st.isFile()) return null;
      return saveFile(this.opts.agentId, readFileSync(rawPath), mimeTypeForFilename(rawPath), basename(rawPath));
    } catch {
      return null;
    }
  }

  private wake(): void {
    if (this.resolveWake) {
      const r = this.resolveWake;
      this.resolveWake = null;
      r();
    }
  }

  private markEnded(): void {
    this.ended = true;
    this.wake();
  }

  // -------------------------------------------------------------------------
  // Notification routing
  // -------------------------------------------------------------------------

  private handleNotification(n: JsonRpcNotification): void {
    handleCodexNotification(n, {
      threadId: this.threadId,
      selfInterruptedForAuth: this.selfInterruptedForAuth,
      authSignalEmittedThisTurn: this.authSignalEmittedThisTurn,
      usage: this.usage,
      setActiveTurnId: (turnId) => {
        this.activeTurnId = turnId;
      },
      clearTurnInFlight: () => {
        this.turnInFlight = false;
      },
      resetAuthTurnState: () => {
        this.authSignalsAllowedThisTurn = false;
        this.authSignalEmittedThisTurn = false;
        this.selfInterruptedForAuth = false;
      },
      enqueue: (event) => this.enqueue(event),
      enqueueAuthAwareSystemText: (text) => this.enqueueAuthAwareSystemText(text),
      attachmentFromPath: (rawPath) => this.attachmentFromPath(rawPath),
    });
  }

  // -------------------------------------------------------------------------
  // Server-initiated request routing
  // -------------------------------------------------------------------------

  private async handleServerRequest(req: JsonRpcRequest): Promise<unknown> {
    return handleCodexServerRequest(req, {
      threadId: this.threadId,
      pendingApprovals: this.pendingApprovals,
      enqueue: (event) => this.enqueue(event),
    });
  }

  // -------------------------------------------------------------------------
  // Stderr + subprocess exit
  // -------------------------------------------------------------------------

  private handleStderr(chunk: string): void {
    // Codex stderr is opaque process output. Route to the agent log as
    // system_text so the boss has visibility. Trim trailing newlines and
    // skip pure whitespace.
    const text = chunk.trimEnd();
    if (!text) return;
    // Drop known-benign startup notices. Codex logs these at ERROR level
    // but they're informational: the bubblewrap line is a "here's how our
    // Linux sandbox works" note, and the trusted-project line tells the
    // user how to opt into project-local config — neither is actionable
    // for Bureau users in the chat.
    if (/bubblewrap.*needs access to create user namespaces/i.test(text) || /until the project is trusted, but skills still load/i.test(text)) {
      return;
    }
    // Route through the auth-aware gate so codex's websocket retry burst
    // produces at most one user-visible signal per turn (Claude-SDK parity).
    this.enqueueAuthAwareSystemText(`[codex stderr] ${text}`);
  }

  private handleSubprocessExit(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.closed) return;
    // The per-turn auth-coalescing gate must close on subprocess death so an
    // unlikely-but-possible later stderr (e.g. drained late) doesn't sneak
    // through with a stale-open gate.
    this.authSignalsAllowedThisTurn = false;
    this.authSignalEmittedThisTurn = false;
    this.selfInterruptedForAuth = false;
    // If a turn was in flight when codex died, synthesize a failed
    // turn_completed so the orchestrator's pendingTurn unblocks.
    if (this.turnInFlight) {
      this.turnInFlight = false;
      this.enqueue({
        kind: "turn_completed",
        status: "failed",
        error: `codex subprocess exited${code != null ? ` (code ${code})` : ""}${signal ? ` (signal ${signal})` : ""} mid-turn`,
      });
    } else {
      this.enqueue({
        kind: "system_text",
        text: `Codex subprocess exited${code != null ? ` (code ${code})` : ""}${signal ? ` (signal ${signal})` : ""}.`,
      });
    }
    this.markEnded();
  }
}
