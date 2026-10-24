import { openCodeRequest } from "./connection/request.ts";
import { OpenCodeTurnCleanup, createTurnCleanup } from "./connection/turn-cleanup.ts";
import { BureauLogError, errorLogParam } from "../../../shared/i18n/backend-errors/error.ts";
import { logMessage } from "../../../shared/i18n/log-message.ts";
import { bureauSystemNotice, bureauTurnFailure } from "../session-types.ts";
import type { AgentMcpServer } from "../../integrations/mcp.ts";
import { OpenCodeTurnAccounting } from "./connection/turn-accounting.ts";
// Stable prompts and per-session authority handles preserve the prompt cache.

import { buildPromptParts } from "./connection/prompt.ts";
import { modelCatalogFor, OpenCodeModelSelection } from "./connection/model-catalog.ts";
import type { ApprovalDecision, AttachmentSpec, NormalizedEvent, NormalizedMessage } from "../types.ts";
import { allowMessages, allowSession, parseAllowedEvent, splitModel, type OpenCodeContextBreakdown } from "./parse.ts";
import type { OpenCodeLease, OpenCodeSupervisor } from "./supervisor.ts";
import { applyOpenCodeEvent, type TrackedTool } from "./transport-events.ts";
import { openCodeAuthorityBroker, type OpenCodeAuthorityBinding, type OpenCodeAuthorityBroker } from "./authority-broker.ts";
import { OPENCODE_TURN_HANDLE_PLACEHOLDER } from "./office-proxy-shared.ts";
import { readOpenCodeEvent, OPENCODE_DEADLINE_MS } from "./connection/deadlines.ts";

type EventSink = (event: NormalizedEvent) => void;

export type { OpenCodeTransportOptions } from "./connection/transport-options.ts";
import type { OpenCodeTransportOptions } from "./connection/transport-options.ts";

export class OpenCodeTransport {
  private readonly disableTools: boolean;
  private readonly mcpServers?: AgentMcpServer[];
  private readonly resolveEnv: OpenCodeTransportOptions["resolveEnv"];
  private announcedSession = false;
  private readonly supervisor: OpenCodeSupervisor;
  private readonly modelSelection: OpenCodeModelSelection;
  private readonly cwd: string;
  private readonly model: string;
  private readonly systemPrompt: string | undefined;
  private readonly agent: string | undefined;
  private readonly autoApprove: boolean;
  private readonly authorityBroker: OpenCodeAuthorityBroker;
  private readonly resumedSessionId?: string;
  private readonly requestTimeoutMs: number;
  private readonly eventIdleTimeoutMs: number;
  private lease: OpenCodeLease | null = null;
  private sessionId: string | null = null;
  private abortController: AbortController | null = null;
  private activeTurn = false;
  private startingTurn = false;
  private abortRequested = false;
  private turn: OpenCodeTurnCleanup | null = null;
  private cleaning: Promise<void> = Promise.resolve();
  private closed = false;
  private latestContext: OpenCodeContextBreakdown | null = null;
  private authorityBinding: OpenCodeAuthorityBinding | null = null;

  constructor(options: OpenCodeTransportOptions) {
    this.supervisor = options.supervisor;
    this.disableTools = options.disableTools === true;
    this.mcpServers = options.mcpServers;
    this.resolveEnv = options.resolveEnv;
    this.cwd = options.cwd;
    this.model = options.model;
    this.modelSelection = new OpenCodeModelSelection(modelCatalogFor(options.supervisor), options.cwd, options.model, options.effort, options.requestTimeoutMs);
    this.authorityBroker = options.authorityBroker ?? openCodeAuthorityBroker;
    if (options.agentId && options.agentToken) {
      this.authorityBinding = this.authorityBroker.bind(options.agentId, options.agentToken);
    }
    this.systemPrompt = this.authorityBinding ? options.systemPrompt?.replaceAll(OPENCODE_TURN_HANDLE_PLACEHOLDER, this.authorityBinding.handle) : options.systemPrompt;
    this.agent = options.agent;
    this.autoApprove = options.autoApprove ?? !!options.agent;
    this.resumedSessionId = options.sessionId;
    this.requestTimeoutMs = options.requestTimeoutMs ?? OPENCODE_DEADLINE_MS;
    this.eventIdleTimeoutMs = options.eventIdleTimeoutMs ?? OPENCODE_DEADLINE_MS;
  }

  contextLimit(): number | undefined {
    return this.modelSelection.contextLimit;
  }

  compactionLimit(): number | undefined {
    return this.modelSelection.limits ? this.supervisor.compactionLimit(this.modelSelection.limits) : undefined;
  }

  modelId(): string {
    return this.model;
  }

  latestContextBreakdown(): OpenCodeContextBreakdown | null {
    return this.latestContext;
  }

  async initialize(sink: EventSink): Promise<string> {
    this.lease ??= await this.supervisor.acquire(this.resolveEnv?.(), this.mcpServers);
    if (!this.sessionId) {
      if (this.systemPrompt !== undefined) this.modelSelection.prefetch(this.lease);
      if (this.resumedSessionId) this.sessionId = this.resumedSessionId;
      else {
        const response = await this.request("/session", {
          method: "POST",
          body: JSON.stringify({ title: "Bureau OpenCode session", ...(this.disableTools ? { permission: [{ permission: "*", pattern: "*", action: "deny" }] } : {}) }),
        });
        this.sessionId = allowSession(await response.json()).id;
      }
    }
    if (this.announcedSession) return this.sessionId;
    sink({ kind: "system_init", sessionId: this.sessionId, model: this.model });
    this.announcedSession = true;
    return this.sessionId;
  }

  async send(text: string, attachments: AttachmentSpec[] | undefined, agentId: string, sink: EventSink): Promise<void> {
    if (this.systemPrompt === undefined) {
      sink(bureauTurnFailure(logMessage("logs.backend.missingPrompt")));
      return;
    }
    if (this.systemPrompt.includes(OPENCODE_TURN_HANDLE_PLACEHOLDER)) {
      sink(bureauTurnFailure(logMessage("logs.backend.missingBinding")));
      return;
    }
    if (this.activeTurn || this.startingTurn) throw new BureauLogError(logMessage("logs.backendError.activeTurn"));
    this.startingTurn = true;
    let sessionId: string;
    try {
      await this.cleaning;
      if (this.closed) return;
      this.resetLease();
      sessionId = await this.initialize(sink);
      if (this.closed) {
        this.lease?.release();
        return;
      }
      await this.lease!.beginTurn();
      if (this.closed) {
        this.lease!.endTurn();
        this.lease!.release();
        return;
      }
      this.turn = createTurnCleanup(this.lease!, this.cwd, sessionId, this.requestTimeoutMs);
      this.activeTurn = true;
    } catch (error) {
      this.lease?.endTurn();
      throw error;
    } finally {
      this.startingTurn = false;
    }
    const lease = this.lease!;
    let turn = this.turn!;
    const controller = (this.abortController = new AbortController());
    try {
      this.authorityBinding?.activate(this.lease!.pid);
      this.activeTurn = true;
      this.abortRequested = false;
      try {
        await this.consumeEvents(sessionId, sink, controller.signal);
      } catch (error) {
        if (controller.signal.aborted || this.closed) throw error;
        await this.lease!.recoverBeforePrompt();
        turn = this.turn = createTurnCleanup(lease, this.cwd, sessionId, this.requestTimeoutMs);
        this.authorityBinding?.activate(this.lease!.pid);
        await this.consumeEvents(sessionId, sink, controller.signal);
      }
      const [providerID, modelID] = splitModel(this.model);
      const { variant, notice, noticeMessage } = await this.modelSelection.resolve(this.lease!);
      controller.signal.throwIfAborted();
      if (notice) sink(noticeMessage ? bureauSystemNotice(noticeMessage) : { kind: "system_text", text: notice, bureauAuthored: true });
      const parts = buildPromptParts(text, attachments, agentId);
      turn.submitted = true;
      await this.request(`/session/${encodeURIComponent(sessionId)}/prompt_async`, {
        method: "POST",
        body: JSON.stringify({
          model: { providerID, modelID },
          ...(variant ? { variant } : {}),
          ...(this.agent ? { agent: this.agent } : {}),
          system: this.systemPrompt,
          parts,
        }),
      });
    } catch (error) {
      controller.abort();
      const wasActive = this.turn === turn && this.activeTurn && !turn.ended;
      if (!wasActive) return;
      if (wasActive && !turn.submitted && !this.abortRequested && !this.closed) lease.markUnresponsive?.();
      this.activeTurn = false;
      this.authorityBinding?.deactivate();
      if (wasActive) this.cleaning = turn.finish(true).finally(() => lease.endTurn());
      if (wasActive)
        sink(
          this.abortRequested
            ? { kind: "turn_completed", status: "interrupted" }
            : error instanceof BureauLogError
              ? bureauTurnFailure(error.logMessage)
              : error instanceof Error
                ? { kind: "turn_completed", status: "failed", error: error.message }
                : bureauTurnFailure(logMessage("logs.backend.requestFailed")),
        );
    }
  }

  private resetLease() {
    this.lease?.release();
    this.lease = null;
  }

  async abort(): Promise<void> {
    if (!this.activeTurn) return;
    this.abortRequested = true;
    if (!this.turn?.submitted) this.abortController?.abort();
    await this.turn?.stop();
  }

  async approve(approvalId: string, decision: ApprovalDecision): Promise<void> {
    if (!this.turn?.hasPending(approvalId)) return;
    if (decision.kind !== "allow_once" && decision.kind !== "deny") {
      throw new BureauLogError(logMessage("logs.backendError.approval"));
    }
    await this.turn.reply(approvalId, decision.kind === "allow_once" ? "once" : "reject", decision.kind === "deny" ? decision.reason : undefined);
  }

  async getSessionMessages(): Promise<NormalizedMessage[]> {
    const sessionId = await this.initialize(() => undefined);
    const response = await this.request(`/session/${encodeURIComponent(sessionId)}/message`);
    return allowMessages(await response.json());
  }

  async forkAtMessage(messageId: string | null): Promise<string> {
    const sessionId = await this.initialize(() => undefined);
    const response = await this.request(`/session/${encodeURIComponent(sessionId)}/fork`, {
      method: "POST",
      body: JSON.stringify(messageId === null ? {} : { messageID: messageId }),
    });
    return allowSession(await response.json()).id;
  }

  canAbortInPlace(): boolean {
    return this.activeTurn;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    const lease = this.lease;
    if (this.turn) this.cleaning = this.turn.finish(true);
    this.abortController?.abort();
    this.authorityBinding?.deactivate();
    this.authorityBinding?.unbind();
    this.authorityBinding = null;
    void this.cleaning.finally(() => {
      lease?.endTurn();
      lease?.release();
    });
  }

  private async consumeEvents(sessionId: string, sink: EventSink, signal: AbortSignal): Promise<void> {
    const turn = this.turn!;
    const lease = this.lease!;
    const response = await this.request("/event", { signal });
    if (!response.body) throw new BureauLogError(logMessage("logs.backendError.noBody"));
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const assistantMessages = new Set<string>();
    const textByPart = new Map<string, string>();
    const reasoningByPart = new Map<string, string>();
    const tools = new Map<string, TrackedTool>();
    const seenPermissions = new Set<string>();
    const accounting = new OpenCodeTurnAccounting();
    let settled = false;
    const settle = (event: NormalizedEvent): void => {
      if (settled || this.turn !== turn || turn.ended) return;
      settled = true;
      this.activeTurn = false;
      this.cleaning = turn.finish(event.kind === "turn_completed" && event.status === "failed").finally(() => lease.endTurn());
      this.authorityBinding?.deactivate();
      sink(event.kind === "turn_completed" ? { ...event, ...accounting.totals(sessionId) } : event);
      this.abortController?.abort();
    };
    let buffer = "";
    void (async () => {
      try {
        while (!signal.aborted) {
          const { done, value } = await readOpenCodeEvent(reader, this.eventIdleTimeoutMs);
          if (done) break;
          buffer = `${buffer}${decoder.decode(value, { stream: true })}`.replaceAll("\r\n", "\n");
          let boundary: number;
          while ((boundary = buffer.indexOf("\n\n")) >= 0) {
            const frame = buffer.slice(0, boundary);
            buffer = buffer.slice(boundary + 2);
            const data = frame
              .split("\n")
              .filter((line) => line.startsWith("data:"))
              .map((line) => line.slice(5).trimStart())
              .join("\n");
            const event = parseAllowedEvent(data);
            if (!event || event.sessionId !== sessionId) continue;
            if (settled || signal.aborted || turn.ended || (this.abortRequested && event.kind === "permission")) {
              if (event.kind === "permission") void turn.rejectLate(event.id);
              continue;
            }
            applyOpenCodeEvent(event, {
              model: this.model,
              needsApiKey: ["opencode", "opencode-go"].includes(splitModel(this.model)[0]) && !this.lease?.hasLaunchVariable?.("OPENCODE_API_KEY") && this.modelSelection.isFree !== true,
              sink,
              settle,
              abortRequested: this.abortRequested,
              autoApprove: this.autoApprove,
              replyPermission: (id, reply) => turn.reply(id, reply).catch(() => settle(bureauTurnFailure(logMessage("logs.backend.permissionFault")))),
              setPendingPermission: (pending) => {
                if (pending) turn.track(pending.id);
              },
              assistantMessages,
              textByPart,
              reasoningByPart,
              tools,
              seenPermissions,
              accounting,
              onContext: (breakdown) => {
                this.latestContext = breakdown;
              },
            });
          }
        }
        if (!signal.aborted) {
          settle(bureauTurnFailure(logMessage("logs.backend.streamEnded")));
        }
      } catch (error) {
        if (!signal.aborted) {
          settle(bureauTurnFailure(logMessage("logs.backend.streamFailed", { error: error instanceof Error ? errorLogParam(error) : logMessage("logs.backend.unknownError") })));
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    })();
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.lease) throw new BureauLogError(logMessage("logs.backendError.uninitialized"));
    return openCodeRequest(this.lease, this.cwd, this.requestTimeoutMs)(path, init);
  }
}
