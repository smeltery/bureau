import { logContent, logMessage, type LogMessage } from "../../../shared/i18n/log-message.ts";
// User-visible wording for a backend that died.
//
// Several orchestrator sites used to paste the raw string the backend threw:
//
//   "Claude Code process exited with code 143"
//   "Agent stopped: error_during_execution. [ede_diagnostic] ..."
//
// Neither says what happened, what caused it, or what to do next. This module
// maps the raw string to a sentence that answers those, and hands the raw
// string back so the caller can keep it in the log entry's metadata.
//
// Pass-through is the default. An unrecognized failure keeps its original text
// verbatim: a wrong explanation is worse than an opaque one.
//
// Callers that detect auth / session-file issues MUST classify on the raw text,
// not on the humanized sentence.

export type BackendFailureId = `sigterm:${number}` | `sigkill:${number}` | `signal:${number}` | "stopped-during-turn" | "unclassified";

export type BackendFailureText = {
  /** What the user reads in chat. */
  text: string;
  message?: LogMessage;
  /** Original string when `text` differs; kept for diagnostics metadata. */
  raw?: string;
  /** Language-independent identity for de-duplicating the same death. */
  id: BackendFailureId;
};

// A process killed by signal N exits with code 128+N (POSIX shell convention).
const SIGNAL_EXIT_MIN = 129;
const SIGNAL_EXIT_MAX = 192;
const SIGTERM_EXIT = 143;
const SIGKILL_EXIT = 137;

export const BACKEND_STOPPED_DURING_TURN = "The agent backend stopped during the turn. The conversation is saved and can be resumed.";

/** Matches SDK / adapter exit wording: "exited with code 143", "exited (code 137)". */
const EXIT_CODE_RE = /exited(?:\s+with)?\s+(?:\(code\s+|code\s+)(\d+)\)?/i;

export function backendStoppedDuringTurn(): string {
  return BACKEND_STOPPED_DURING_TURN;
}

export function humanizeBackendFailure(raw: string): BackendFailureText {
  const exitMatch = EXIT_CODE_RE.exec(raw);
  if (exitMatch) {
    const code = Number(exitMatch[1]);
    if (code === SIGTERM_EXIT) {
      return translatedFailure(raw, `sigterm:${SIGTERM_EXIT}`, logMessage("logs.diagnostic.terminated", { code: SIGTERM_EXIT }));
    }
    if (code === SIGKILL_EXIT) {
      return translatedFailure(raw, `sigkill:${SIGKILL_EXIT}`, logMessage("logs.diagnostic.killed", { code: SIGKILL_EXIT }));
    }
    if (code >= SIGNAL_EXIT_MIN && code <= SIGNAL_EXIT_MAX) {
      return translatedFailure(raw, `signal:${code}`, logMessage("logs.diagnostic.signal", { signal: code - 128, code }));
    }
    // Ordinary non-signal exit: leave for diagnoseProcessExit / other hints.
    return { text: raw, id: "unclassified" };
  }

  // Harness-internal error_during_execution blobs are not useful to a human.
  if (raw.includes("error_during_execution")) {
    return translatedFailure(raw, "stopped-during-turn", logMessage("logs.diagnostic.stoppedDuringTurn"));
  }

  return { text: raw, id: "unclassified" };
}

/** Metadata blob for rewritten failures; undefined when text was unchanged. */
export function backendFailureMeta(failure: BackendFailureText): Record<string, unknown> | undefined {
  return failure.raw === undefined ? undefined : { backendFailureRaw: failure.raw };
}

function translatedFailure(raw: string, id: BackendFailureId, message: LogMessage): BackendFailureText {
  return { text: logContent(message).content, message, raw, id };
}
