import type { NormalizedEvent } from "../types.ts";
import { AUTH_ERROR_PATTERNS } from "./config.ts";
import type { JsonRpcLiteClient } from "./client.ts";

export class CodexAuthSignalGate {
  private allowedThisTurn = false;
  private emittedThisTurn = false;
  private selfInterrupted = false;

  get authSignalEmittedThisTurn(): boolean {
    return this.emittedThisTurn;
  }

  get selfInterruptedForAuth(): boolean {
    return this.selfInterrupted;
  }

  openTurn(): void {
    this.allowedThisTurn = true;
    this.emittedThisTurn = false;
  }

  resetTurn(): void {
    this.allowedThisTurn = false;
    this.emittedThisTurn = false;
    this.selfInterrupted = false;
  }

  enqueueAuthAwareSystemText(
    text: string,
    opts: {
      threadId: string | null;
      activeTurnId: string | null;
      client: JsonRpcLiteClient;
      enqueue: (event: NormalizedEvent) => void;
    },
  ): void {
    if (AUTH_ERROR_PATTERNS.test(text)) {
      if (!this.allowedThisTurn) return;
      if (this.emittedThisTurn) return;
      this.emittedThisTurn = true;
      this.requestSelfInterruptForAuth(opts);
    }
    opts.enqueue({ kind: "system_text", text });
  }

  private requestSelfInterruptForAuth({ threadId, activeTurnId, client }: { threadId: string | null; activeTurnId: string | null; client: JsonRpcLiteClient }): void {
    if (this.selfInterrupted) return;
    if (!threadId || !activeTurnId) return;
    this.selfInterrupted = true;
    client
      .request("turn/interrupt", {
        threadId,
        turnId: activeTurnId,
      })
      .catch(() => {});
  }
}
