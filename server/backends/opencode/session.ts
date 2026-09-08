import type { ApprovalDecision, AttachmentSpec, BackendSession, ContextUsage, CreateSessionOptions, NormalizedEvent, SubscriptionUsageResult } from "../types.ts";
import { permissionAgent } from "./config.ts";
import type { OpenCodeSupervisor } from "./supervisor.ts";
import { OpenCodeTransport } from "./transport.ts";

export class OpenCodeBackendSession implements BackendSession {
  private readonly events: NormalizedEvent[] = [];
  private wake: (() => void) | null = null;
  private ended = false;
  private readonly transport: OpenCodeTransport;
  private readonly agentId: string;

  constructor(
    opts: CreateSessionOptions,
    model: string,
    supervisor: OpenCodeSupervisor,
    sessionId?: string,
    private readonly onSessionId?: (sessionId: string) => void,
  ) {
    this.agentId = opts.agentId;
    this.transport = new OpenCodeTransport({
      cwd: opts.cwd,
      model,
      systemPrompt: opts.systemPrompt,
      agent: permissionAgent(opts.permissionMode),
      autoApprove: opts.permissionMode === "bypassPermissions",
      supervisor,
      sessionId,
    });
  }

  private push = (event: NormalizedEvent): void => {
    if (this.ended) return;
    if (event.kind === "system_init" && event.sessionId) this.onSessionId?.(event.sessionId);
    this.events.push(event);
    const wake = this.wake;
    this.wake = null;
    wake?.();
  };

  async *stream(): AsyncIterable<NormalizedEvent> {
    while (true) {
      while (this.events.length > 0) yield this.events.shift()!;
      if (this.ended) return;
      await new Promise<void>((resolve) => {
        this.wake = resolve;
      });
    }
  }

  async getContextUsage(): Promise<ContextUsage | null> {
    const breakdown = this.transport.latestContextBreakdown();
    if (!breakdown) return null;
    // Without a discovered context limit, expose tokens with a conservative
    // synthetic max so the battery still moves.
    const maxTokens = Math.max(breakdown.totalTokens, 200_000);
    return {
      model: this.transport.modelId(),
      totalTokens: breakdown.totalTokens,
      maxTokens,
      percentage: Math.min(100, (breakdown.totalTokens / maxTokens) * 100),
      categories: [
        { name: "Input", tokens: breakdown.inputTokens },
        { name: "Cached input", tokens: breakdown.cacheReadInputTokens },
        { name: "Cache creation", tokens: breakdown.cacheCreationInputTokens },
        { name: "Output", tokens: breakdown.outputTokens },
        { name: "Reasoning", tokens: breakdown.reasoningTokens },
      ],
    };
  }

  async getSubscriptionUsage(): Promise<SubscriptionUsageResult> {
    return { kind: "unavailable" };
  }

  async send(text: string, attachments?: AttachmentSpec[]): Promise<void> {
    await this.transport.send(text, attachments, this.agentId, this.push);
  }

  async approve(approvalId: string, decision: ApprovalDecision): Promise<void> {
    await this.transport.approve(approvalId, decision);
  }

  async abort(): Promise<void> {
    await this.transport.abort();
  }

  canAbortInPlace(): boolean {
    return this.transport.canAbortInPlace();
  }

  close(): void {
    if (this.ended) return;
    this.ended = true;
    this.transport.close();
    const wake = this.wake;
    this.wake = null;
    wake?.();
  }

  /** @internal test/admin helper */
  getTransport(): OpenCodeTransport {
    return this.transport;
  }
}
