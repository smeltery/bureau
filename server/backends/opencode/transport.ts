// Thin HTTP + SSE client that maps OpenCode serve events onto Bureau
// NormalizedEvent. No authority-broker / credential-scan — deferred.
//
// Prompt-cache stability: `systemPrompt` is bound once in the constructor and
// sent verbatim on every `prompt_async`. Bureau has no per-turn office/auth
// handle to rotate into the prompt (that broker lives upstream and is out of
// MVP scope), so the system payload is already byte-identical across turns.
// Keep it that way — do not rebuild or interpolate the system string per turn.

import { formatAttachmentLines, resolveAttachmentNotices } from "../../attachment-prompt.ts";
import type { ApprovalDecision, AttachmentSpec, NormalizedEvent, NormalizedMessage, TokenUsage } from "../types.ts";
import { allowMessages, allowSession, parseAllowedEvent, splitModel, type OpenCodeContextBreakdown } from "./parse.ts";
import type { OpenCodeLease, OpenCodeSupervisor } from "./supervisor.ts";
import { applyOpenCodeEvent, type TrackedTool } from "./transport-events.ts";

type EventSink = (event: NormalizedEvent) => void;

export interface OpenCodeTransportOptions {
  cwd: string;
  model: string;
  systemPrompt?: string;
  agent?: string;
  supervisor: OpenCodeSupervisor;
  sessionId?: string;
  autoApprove?: boolean;
}

export class OpenCodeTransport {
  private readonly supervisor: OpenCodeSupervisor;
  private readonly cwd: string;
  private readonly model: string;
  private readonly systemPrompt: string | undefined;
  private readonly agent: string | undefined;
  private readonly autoApprove: boolean;
  private readonly resumedSessionId?: string;
  private lease: OpenCodeLease | null = null;
  private sessionId: string | null = null;
  private abortController: AbortController | null = null;
  private activeTurn = false;
  private abortRequested = false;
  private pendingPermission: { id: string; sessionId: string } | null = null;
  private closed = false;
  private latestContext: OpenCodeContextBreakdown | null = null;

  constructor(options: OpenCodeTransportOptions) {
    this.supervisor = options.supervisor;
    this.cwd = options.cwd;
    this.model = options.model;
    this.systemPrompt = options.systemPrompt;
    this.agent = options.agent;
    this.autoApprove = options.autoApprove ?? !!options.agent;
    this.resumedSessionId = options.sessionId;
  }

  modelId(): string {
    return this.model;
  }

  latestContextBreakdown(): OpenCodeContextBreakdown | null {
    return this.latestContext;
  }

  async initialize(sink: EventSink): Promise<string> {
    if (this.sessionId) return this.sessionId;
    this.lease = await this.supervisor.acquire();
    if (this.resumedSessionId) {
      this.sessionId = this.resumedSessionId;
    } else {
      const response = await this.request("/session", {
        method: "POST",
        body: JSON.stringify({ title: "Bureau OpenCode session" }),
      });
      this.sessionId = allowSession(await response.json()).id;
    }
    sink({ kind: "system_init", sessionId: this.sessionId, model: this.model });
    return this.sessionId;
  }

  async send(text: string, attachments: AttachmentSpec[] | undefined, agentId: string, sink: EventSink): Promise<void> {
    if (this.systemPrompt === undefined) {
      sink({ kind: "turn_completed", status: "failed", error: "OpenCode cannot send a turn without a system prompt." });
      return;
    }
    const sessionId = await this.initialize(sink);
    await this.lease!.beginTurn();
    try {
      this.activeTurn = true;
      this.abortRequested = false;
      this.abortController = new AbortController();
      await this.consumeEvents(sessionId, sink, this.abortController.signal);
      const [providerID, modelID] = splitModel(this.model);
      const parts = buildPromptParts(text, attachments, agentId);
      await this.request(`/session/${encodeURIComponent(sessionId)}/prompt_async`, {
        method: "POST",
        body: JSON.stringify({
          model: { providerID, modelID },
          ...(this.agent ? { agent: this.agent } : {}),
          system: this.systemPrompt,
          parts,
        }),
      });
    } catch (error) {
      this.abortController?.abort();
      this.activeTurn = false;
      this.lease!.endTurn();
      sink({
        kind: "turn_completed",
        status: "failed",
        error: error instanceof Error ? error.message : "OpenCode request failed.",
      });
    }
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
      throw new Error("OpenCode supports Allow once and Deny.");
    }
    this.pendingPermission = null;
    await this.replyPermission(approvalId, decision.kind === "allow_once" ? "once" : "reject", decision.kind === "deny" ? decision.reason : undefined);
  }

  async getSessionMessages(): Promise<NormalizedMessage[]> {
    const sessionId = await this.initialize(() => undefined);
    const response = await this.request(`/session/${encodeURIComponent(sessionId)}/message`);
    return allowMessages(await response.json());
  }

  async forkAtMessage(messageId: string): Promise<string> {
    const sessionId = await this.initialize(() => undefined);
    const response = await this.request(`/session/${encodeURIComponent(sessionId)}/fork`, {
      method: "POST",
      body: JSON.stringify({ messageID: messageId }),
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
    this.lease?.endTurn();
    this.lease?.release();
  }

  private async consumeEvents(sessionId: string, sink: EventSink, signal: AbortSignal): Promise<void> {
    const response = await this.request("/event", { signal });
    if (!response.body) throw new Error("OpenCode event stream has no body.");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const assistantMessages = new Set<string>();
    const textByPart = new Map<string, string>();
    const reasoningByPart = new Map<string, string>();
    const tools = new Map<string, TrackedTool>();
    const seenPermissions = new Set<string>();
    let stepFinish: { usage?: TokenUsage; cost?: number } | null = null;
    let settled = false;
    const settle = (event: NormalizedEvent): void => {
      if (settled) return;
      settled = true;
      this.activeTurn = false;
      this.pendingPermission = null;
      this.lease?.endTurn();
      sink(event);
      this.abortController?.abort();
    };
    let buffer = "";
    void (async () => {
      try {
        while (!signal.aborted) {
          const { done, value } = await reader.read();
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
            if (!data) continue;
            const event = parseAllowedEvent(data);
            if (!event || event.sessionId !== sessionId) continue;
            applyOpenCodeEvent(event, {
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
              setStepFinish: (v) => {
                stepFinish = v;
              },
              getStepFinish: () => stepFinish,
              onContext: (breakdown) => {
                this.latestContext = breakdown;
              },
            });
            if (settled) return;
          }
        }
        if (!signal.aborted) {
          settle({ kind: "turn_completed", status: "failed", error: "OpenCode event stream ended before turn completion." });
        }
      } catch (error) {
        if (!signal.aborted) {
          settle({
            kind: "turn_completed",
            status: "failed",
            error: `OpenCode event stream failed: ${error instanceof Error ? error.message : "unknown error"}`,
          });
        }
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
    if (!this.lease) throw new Error("OpenCode transport is not initialized.");
    const url = new URL(path, this.lease.baseUrl);
    url.searchParams.set("directory", this.cwd);
    const response = await fetch(url, {
      ...init,
      headers: {
        authorization: this.lease.authHeader,
        ...(init.body ? { "content-type": "application/json" } : {}),
        ...init.headers,
      },
    });
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`OpenCode HTTP ${response.status} at ${path}.`);
    }
    return response;
  }
}

export function buildPromptParts(text: string, attachments: AttachmentSpec[] | undefined, agentId: string): Array<{ type: "text"; text: string }> {
  const parts: Array<{ type: "text"; text: string }> = [];
  if (text) parts.push({ type: "text", text });
  const lines = formatAttachmentLines(resolveAttachmentNotices(agentId, attachments ?? []));
  if (lines.length > 0) parts.push({ type: "text", text: lines.join("\n") });
  if (parts.length === 0) parts.push({ type: "text", text: "" });
  return parts;
}
