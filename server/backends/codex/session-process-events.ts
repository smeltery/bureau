import { bureauSystemNotice, bureauTurnFailure } from "../session-types.ts";
import { logMessage } from "../../../shared/i18n/log-message.ts";
import type { NormalizedEvent } from "../types.ts";
import { filterMissingToolOutputRepeats } from "../../../shared/log-types.ts";

export function handleCodexSessionStderr(chunk: string, seenMissingToolOutputs: Set<string>, enqueueAuthAwareSystemText: (text: string) => void): void {
  // Codex stderr is opaque process output. Route to the agent log as
  // system_text so the boss has visibility. Trim trailing newlines and
  // skip pure whitespace.
  const text = filterMissingToolOutputRepeats(chunk.trimEnd(), seenMissingToolOutputs);
  if (!text) return;
  // A chunk can contain both a startup notice and an actionable failure.
  // Keep sandbox diagnostics: host namespace policy can prevent tool execution.
  const visible = text
    .split("\n")
    .filter((line) => !/until the project is trusted, but skills still load/i.test(line))
    .join("\n")
    .trim();
  if (!visible) return;
  // Route through the auth-aware gate so codex's websocket retry burst
  // produces at most one user-visible signal per turn (Claude-SDK parity).
  enqueueAuthAwareSystemText(`[codex stderr] ${visible}`);
}

export function codexSubprocessExitEvent({ code, signal, turnInFlight }: { code: number | null; signal: NodeJS.Signals | null; turnInFlight: boolean }): NormalizedEvent {
  if (turnInFlight) {
    return bureauTurnFailure(
      logMessage("logs.backend.processMidExit", { code: code != null ? logMessage("logs.backend.exitCode", { code }) : "", signal: signal ? logMessage("logs.backend.exitSignal", { signal }) : "" }),
    );
  }
  return bureauSystemNotice(
    logMessage("logs.backend.processExit", { code: code != null ? logMessage("logs.backend.exitCode", { code }) : "", signal: signal ? logMessage("logs.backend.exitSignal", { signal }) : "" }),
  );
}
