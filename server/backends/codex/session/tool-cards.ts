import type { NormalizedEvent, SubagentOrigin } from "../../types.ts";
import { translateCompletedItem } from "../completed-items.ts";

// These items have their input at start. Web searches acquire their query later.
const EARLY_CARDS = new Set(["commandExecution", "fileChange", "mcpToolCall", "collabAgentToolCall"]);

export class CodexToolCards {
  private shown = new Set<string>();

  started(threadId: string, item: unknown, subagent?: SubagentOrigin): NormalizedEvent | null {
    const raw = item as { type?: string; id?: string } | null;
    if (!raw?.type || !EARLY_CARDS.has(raw.type) || typeof raw.id !== "string") return null;
    const key = JSON.stringify([threadId, raw.id]);
    if (this.shown.has(key)) return null;
    // Reuse the transcript's input mapping; results and completion side effects
    // are deliberately ignored until the completed notification arrives.
    const call = translateCompletedItem(item, () => null, { subagent }).find((event) => event.kind === "tool_call");
    if (!call) return null;
    this.shown.add(key);
    return call;
  }

  completed(threadId: string, events: NormalizedEvent[]): NormalizedEvent[] {
    return events.filter((event) => event.kind !== "tool_call" || !this.shown.delete(JSON.stringify([threadId, event.toolUseId])));
  }

  clear(): void {
    this.shown.clear();
  }
}
