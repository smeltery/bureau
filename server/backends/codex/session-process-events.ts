import type { NormalizedEvent } from "../types.ts";
import { filterMissingToolOutputRepeats } from "../../../shared/log-types.ts";

export function handleCodexSessionStderr(chunk: string, seenMissingToolOutputs: Set<string>, enqueueAuthAwareSystemText: (text: string) => void): void {
  // Codex stderr is opaque process output. Route to the agent log as
  // system_text so the boss has visibility. Trim trailing newlines and
  // skip pure whitespace.
  const text = filterMissingToolOutputRepeats(chunk.trimEnd(), seenMissingToolOutputs);
  if (!text) return;
  // Drop known-benign startup notices. Codex logs these at ERROR level
  // but they're informational: the bubblewrap line is a "here's how our
  // Linux sandbox works" note, and the trusted-project line tells the
  // user how to opt into project-local config; neither is actionable
  // for Bureau users in the chat.
  if (/bubblewrap.*needs access to create user namespaces/i.test(text) || /until the project is trusted, but skills still load/i.test(text)) {
    return;
  }
  // Route through the auth-aware gate so codex's websocket retry burst
  // produces at most one user-visible signal per turn (Claude-SDK parity).
  enqueueAuthAwareSystemText(`[codex stderr] ${text}`);
}

export function codexSubprocessExitEvent({ code, signal, turnInFlight }: { code: number | null; signal: NodeJS.Signals | null; turnInFlight: boolean }): NormalizedEvent {
  if (turnInFlight) {
    return {
      kind: "turn_completed",
      status: "failed",
      error: `codex subprocess exited${code != null ? ` (code ${code})` : ""}${signal ? ` (signal ${signal})` : ""} mid-turn`,
    };
  }
  return {
    kind: "system_text",
    text: `Codex subprocess exited${code != null ? ` (code ${code})` : ""}${signal ? ` (signal ${signal})` : ""}.`,
  };
}
