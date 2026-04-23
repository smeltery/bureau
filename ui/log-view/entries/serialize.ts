import type { LogEntry } from "../../../shared/types.ts";

/** Serialize entries for clipboard (text + tool_call only). */
export function serializeEntries(entries: LogEntry[]): string {
  const parts: string[] = [];
  for (const e of entries) {
    if (e.kind === "user_message") {
      parts.push(e.content);
    } else if (e.kind === "text") {
      parts.push(e.content);
    } else if (e.kind === "tool_call") {
      const input = e.metadata?.input;
      const inputStr = typeof input === "string" ? input : JSON.stringify(input, null, 2);
      parts.push(`**${e.content}**\n${inputStr}`);
    }
  }
  return parts.join("\n\n");
}
