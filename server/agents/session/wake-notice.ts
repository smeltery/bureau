import type { ManagedAgent } from "../state-types.ts";
import { buildSessionEnv } from "./session-env.ts";
import { claudeSessionInterruptedByShutdown } from "./shutdown-marker.ts";

// Why the agent's backend session was gone when the next message arrived.
//   boot          — the server (re)started and the session was rebuilt from the
//                   persisted transcript.
//   session-ended — the previous session died without us asking it to (backend
//                   crash, SIGKILL, earlyoom, transport failure).
//   idle          — we released it ourselves to save memory (idle-session
//                   evictor). Nothing was interrupted.
export type DormantWakeReason = "boot" | "session-ended" | "idle";

// Wake-message wording, accurate to WHY the agent had no session: an
// idle-evicted agent was released for idleness; the other two were taken down
// by a server (re)start or a genuine backend death.
//
// Both non-idle branches carry the shutdown warning. When the Claude CLI is
// SIGTERMed mid-turn it hands the model hardcoded text claiming the USER
// rejected the tool that was running. The resumed agent can't tell that from a
// real denial, so it wakes up believing its boss countermanded it and abandons
// the work. It also can't tell whether the killed command had already done half
// its job.
//
// Returns the SAME text on both surfaces: `log` for the Bureau transcript (what
// the human reads) and `note` to arm managed.wakeNotice (what the AGENT reads,
// delivered once as a built-in block by runAgentTurn). Bureau log entries are
// never fed back into a prompt, so a log-only message would miss every
// occurrence this exists to fix — the agent is the one holding the false
// rejection. The calm idle wording has nothing to warn about, so it carries
// note: null and costs the agent no context.
export function dormantWakeMessage(managed: ManagedAgent, reason: DormantWakeReason, sessionId: string): { log: string; note: string | null } {
  if (reason === "idle") {
    return { log: "Resumed your session (it was released while idle to save memory).", note: null };
  }
  const opener = reason === "boot" ? "Resumed your session after the server restarted." : "Resumed your session after the backend ended unexpectedly.";
  const base = `${opener} Any command that was in flight may have partially run; verify its effects before retrying.`;
  const clause = shutdownRejectionClause(managed, sessionId);
  const text = clause ? `${base} ${clause}` : base;
  return { log: text, note: text };
}

// Arm the one-shot wake note and hand back the line to write to the Bureau log.
// The two session-less wake paths (sendMessage's recovery branch and
// flushQueue's) and the boot restore call this in place of their old static
// wake strings, so all three deliver the same truth to the agent and the human.
export function armDormantWakeNotice(managed: ManagedAgent, reason: DormantWakeReason, sessionId: string): string {
  const wake = dormantWakeMessage(managed, reason, sessionId);
  managed.wakeNotice = wake.note;
  return wake.log;
}

// The rejection half of the wake-up message above. Present only when the
// agent's own transcript proves the shutdown forged a rejection result —
// explaining a rejection that may not exist reads as noise. Empty for every
// Codex agent (the marker is a Claude CLI artifact).
function shutdownRejectionClause(managed: ManagedAgent, sessionId: string): string {
  if (managed.info.agentType === "claude" && claudeSessionInterruptedByShutdown(managed.info.cwd, sessionId, envForHints(managed))) {
    return "The 'user rejected' result just above is from the shutdown, not a human.";
  }
  return "";
}

// The env the spawned backend would see, used only to find the right
// CLAUDE_CONFIG_DIR projects/ tree. buildSessionEnv throws when a configured
// env file is missing or unparseable; a wake-up message must never fail on
// that, so a throw degrades to the default (~/.claude) lookup, which at worst
// finds no marker and leaves the wording hedged.
function envForHints(managed: ManagedAgent): { [key: string]: string | undefined } | undefined {
  try {
    return buildSessionEnv(managed);
  } catch {
    return undefined;
  }
}
