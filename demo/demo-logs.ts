import type { LogEntry } from "../shared/types.ts";
import { shimEmit } from "../ui/ws.ts";
import { DEMO_LOGS, OFFICE_CHARACTERS } from "./demo-fixtures.ts";

const DEMO_REPLY =
  "This is a demo — your message was not actually sent to Claude. To use Bureau for real, follow the setup instructions in the [README](https://github.com/smeltery/bureau).";

const pendingReplies = new Map<string, ReturnType<typeof setTimeout>>();

export function seedLogs() {
  const baseTime = Date.now() - 120_000; // start 2 minutes ago
  for (const { agentName, entries } of DEMO_LOGS) {
    const char = OFFICE_CHARACTERS.find((c) => c.name === agentName);
    if (!char) continue;
    const agentId = `demo-${char.name.toLowerCase().replace(/\s+/g, "-")}`;
    let t = baseTime;
    for (const { kind, content, metadata } of entries) {
      t += 3000 + Math.random() * 5000;
      const meta = kind === "user_message" ? { ...metadata, username: "Ricky" } : metadata;
      const entry = makeLogEntry(agentId, kind, content, meta);
      entry.timestamp = t;
      shimEmit({ type: "log_entry", entry });
    }
  }
}

export function sendDemoMessage(agentId: string, text: string, username?: string) {
  const userEntry = makeLogEntry(agentId, "user_message", text, username ? { username } : undefined);
  shimEmit({ type: "log_entry", entry: userEntry });

  const prev = pendingReplies.get(agentId);
  if (prev) clearTimeout(prev);

  shimEmit({ type: "agent_updated", agentId, changes: { state: "thinking" } });
  pendingReplies.set(
    agentId,
    setTimeout(() => {
      pendingReplies.delete(agentId);
      const replyEntry = makeLogEntry(agentId, "text", DEMO_REPLY);
      shimEmit({ type: "log_entry", entry: replyEntry });
      shimEmit({ type: "agent_updated", agentId, changes: { state: "waiting_for_response" } });
    }, 800),
  );
}

export function emitDemoSystemLog(agentId: string, content: string) {
  const entry = makeLogEntry(agentId, "system", content);
  shimEmit({ type: "log_entry", entry });
}

export function abortDemoMessage(agentId: string) {
  const pendingAbort = pendingReplies.get(agentId);
  if (pendingAbort) {
    clearTimeout(pendingAbort);
    pendingReplies.delete(agentId);
  }
  shimEmit({ type: "agent_updated", agentId, changes: { state: "waiting_for_response" } });
  const abortEntry = makeLogEntry(agentId, "system", "Agent interrupted.");
  shimEmit({ type: "log_entry", entry: abortEntry });
}

function makeLogEntry(agentId: string, kind: LogEntry["kind"], content: string, metadata?: Record<string, unknown>): LogEntry {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    agentId,
    timestamp: Date.now(),
    kind,
    content,
    metadata,
  };
}
