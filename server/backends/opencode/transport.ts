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
import { fetchOpenCode, readOpenCodeEvent, OPENCODE_DEADLINE_MS } from "./connection/deadlines.ts";

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
  private abortRequested = false;
  private pendingPermission: { id: string; sessionId: string } | null = null;
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
    if (this.activeTurn) throw new BureauLogError(logMessage("logs.backendError.activeTurn"));
    this.resetLease();
    const sessionId = await this.initialize(sink);
    await this.lease!.beginTurn();
    try {
      this.authorityBinding?.activate(this.lease!.pid);
      this.activeTurn = true;
      this.abortRequested = false;
      this.abortController = new AbortController();
      try {
        await this.consumeEvents(sessionId, sink, this.abortController.signal);
      } catch (error) {
        if (this.abortController.signal.aborted || this.closed) throw error;
        await this.lease!.recoverBeforePrompt();
        this.authorityBinding?.activate(this.lease!.pid);
        await this.consumeEvents(sessionId, sink, this.abortController.signal);
      }
      const [providerID, modelID] = splitModel(this.model);
      const { variant, notice, noticeMessage } = await this.modelSelection.resolve(this.lease!);
      this.abortController.signal.throwIfAborted();
      if (notice) sink(noticeMessage ? bureauSystemNotice(noticeMessage) : { kind: "system_text", text: notice, bureauAuthored: true });
      const parts = buildPromptParts(text, attachments, agentId);
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
      this.abortController?.abort();
      const wasActive = this.activeTurn;
      if (wasActive && !this.abortRequested && !this.closed) this.lease?.markUnresponsive?.();
      this.activeTurn = false;
      this.authorityBinding?.deactivate();
      this.lease!.endTurn();
      if (wasActive)
        sink(
          error instanceof BureauLogError
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
    if (!this.sessionId) return;
    this.abortRequested = true;
    await this.rejectPendingPermission();
    await this.request(`/session/${encodeURIComponent(this.sessionId)}/abort`, { method: "POST" }).catch(() => undefined);
  }

  async approve(approvalId: string, decision: ApprovalDecision): Promise<void> {
    const pending = this.pendingPermission;
    if (!pending || pending.id !== approvalId || pending.sessionId !== this.sessionId) return;
    if (decision.kind !== "allow_once" && decision.kind !== "deny") {
      throw new BureauLogError(logMessage("logs.backendError.approval"));
    }
    this.pendingPermission = null;
    await this.replyPermission(approvalId, decision.kind === "allow_once" ? "once" : "reject", decision.kind === "deny" ? decision.reason : undefined);
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
    if (this.activeTurn) void this.rejectPendingPermission().then(() => this.abort());
    this.abortController?.abort();
    this.authorityBinding?.deactivate();
    this.authorityBinding?.unbind();
    this.authorityBinding = null;
    this.lease?.endTurn();
    this.lease?.release();
  }

  private async consumeEvents(sessionId: string, sink: EventSink, signal: AbortSignal): Promise<void> {
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
      if (settled) return;
      settled = true;
      this.activeTurn = false;
      this.pendingPermission = null;
      this.authorityBinding?.deactivate();
      this.lease?.endTurn();
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
            applyOpenCodeEvent(event, {
              model: this.model,
              needsApiKey: ["opencode", "opencode-go"].includes(splitModel(this.model)[0]) && !this.lease?.hasLaunchVariable?.("OPENCODE_API_KEY") && this.modelSelection.isFree !== true,
              sink,
              settle,
              abortRequested: this.abortRequested,
              autoApprove: this.autoApprove,
              replyPermission: (id, reply) => this.replyPermission(id, reply),
              setPendingPermission: (pending) => {
                this.pendingPermission = pending;
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
            if (settled) return;
          }
        }
        if (!signal.aborted) {
          this.lease?.markUnresponsive?.();
          settle(bureauTurnFailure(logMessage("logs.backend.streamEnded")));
        }
      } catch (error) {
        if (!signal.aborted) {
          this.lease?.markUnresponsive?.();
          settle(bureauTurnFailure(logMessage("logs.backend.streamFailed", { error: error instanceof Error ? errorLogParam(error) : logMessage("logs.backend.unknownError") })));
        }
      } finally {
        await reader.cancel().catch(() => undefined);
      }
    })();
  }

  private async replyPermission(id: string, reply: "once" | "reject", message?: string): Promise<void> {
    await this.request(`/permission/${encodeURIComponent(id)}/reply`, {
      method: "POST",
      body: JSON.stringify({ reply, ...(message ? { message } : {}) }),
    });
  }

  private async rejectPendingPermission(): Promise<void> {
    const pending = this.pendingPermission;
    if (!pending || pending.sessionId !== this.sessionId) return;
    this.pendingPermission = null;
    await this.replyPermission(pending.id, "reject").catch(() => undefined);
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    if (!this.lease) throw new BureauLogError(logMessage("logs.backendError.uninitialized"));
    const url = new URL(path, this.lease.baseUrl);
    url.searchParams.set("directory", this.cwd);
    const response = await fetchOpenCode(
      url,
      {
        ...init,
        headers: {
          authorization: this.lease.authHeader,
          ...(init.body ? { "content-type": "application/json" } : {}),
          ...init.headers,
        },
      },
      this.requestTimeoutMs,
    );
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new BureauLogError(logMessage("logs.backendError.http", { status: response.status, path }));
    }
    return response;
  }
}
