import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";

/** Correlates a main-thread quota refusal with the SDK's structured reset time. */
export class ClaudeQuotaStop {
  private quota: { status: string; reset: number | undefined } | null = null;
  private refused = false;

  observe(message: SDKMessage): number | undefined {
    if (message.type === "rate_limit_event") {
      const info = message.rate_limit_info;
      this.quota = info ? { status: info.status, reset: info.resetsAt } : null;
    } else if (message.type === "assistant" && !message.parent_tool_use_id && message.message.model === "<synthetic>" && message.error === "rate_limit") {
      this.refused = true;
    } else if (message.type === "result") {
      const stopped = this.refused;
      this.refused = false;
      const reset = this.quota?.reset;
      if (stopped && this.quota?.status === "rejected" && typeof reset === "number" && Number.isFinite(reset) && reset > 0 && Number.isSafeInteger(reset * 1000)) return reset * 1000;
    }
    return undefined;
  }
}
