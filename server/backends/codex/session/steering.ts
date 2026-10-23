import type { NormalizedEvent } from "../../types.ts";
import type { TurnSteerParams } from "../_generated/v2/TurnSteerParams.ts";

export class CodexSteering {
  private pending = new Set<string>();
  constructor(
    private state: () => { threadId: string | null; turnId: string | null; closed: boolean },
    private request: (params: TurnSteerParams) => Promise<unknown>,
    private emit: (event: NormalizedEvent) => void,
  ) {}

  async send(text: string, id: string): Promise<boolean> {
    const { threadId, turnId, closed } = this.state();
    if (closed || !threadId || !turnId) return false;
    this.pending.add(id);
    try {
      await this.request({ threadId, expectedTurnId: turnId, clientUserMessageId: id, input: [{ type: "text", text, text_elements: [] }] });
      return true;
    } catch (error) {
      // Only an explicit RPC refusal proves that retrying is safe. A broken
      // connection may have lost the reply after the backend accepted input.
      if (error && typeof error === "object" && "code" in error && typeof error.code === "number") {
        this.pending.delete(id);
        return false;
      }
      return true;
    }
  }

  recorded(item: unknown): void {
    if (!item || typeof item !== "object" || !("type" in item) || item.type !== "userMessage" || !("clientId" in item) || typeof item.clientId !== "string") return;
    if (this.pending.delete(item.clientId)) this.emit({ kind: "steer_delivered", steerId: item.clientId });
  }

  clear(): void {
    this.pending.clear();
  }
}
