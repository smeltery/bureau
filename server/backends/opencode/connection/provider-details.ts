import { bureauTurnFailure } from "../../session-types.ts";
import { logMessage, logParts, type LogMessage } from "../../../../shared/i18n/log-message.ts";
import { redactLogEntry } from "../../../persistence/logs/log-redaction.ts";
import type { SafeOpenCodeError } from "../parse.ts";
import { providerFailureMessage } from "./failures.ts";

/** Redact before truncating so a partial credential cannot evade recognition. */
export function providerDetail(message?: string): string | null {
  if (!message?.trim()) return null;
  const normalized = message
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069]/g, "")
    .replace(/[\s\x00-\x1f\x7f]+/g, " ")
    .trim();
  const scrubbed = normalized
    .replace(/\b(Bearer|Basic)\s+[^\s"'<>]+/gi, "$1 [redacted]")
    .replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, "$1[redacted]@")
    .replace(/([?&](?:api[_-]?key|key|(?:access[_-]?|refresh[_-]?)?token|secret|password)=)[^&#\s]*/gi, "$1[redacted]")
    .replace(/\b((?:api[_-]?key|(?:access[_-]?|refresh[_-]?)?token|secret|password)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/gi, "$1[redacted]");
  const points = Array.from(redactLogEntry({ text: scrubbed }).text);
  return points.length > 300 ? points.slice(0, 299).join("") + "…" : points.join("") || null;
}

export function providerRefusal(error: SafeOpenCodeError, model = "OpenCode"): LogMessage | null {
  if (error.name !== "APIError" || error.statusCode === 401) return null;
  const detail = providerDetail(error.message);
  if (!detail) return null;
  const refused = error.statusCode === undefined ? /rate.?limit|too many requests|quota|usage limit/i.test(detail) : error.statusCode >= 400 && error.statusCode < 500;
  if (!refused) return null;
  const message = logMessage("logs.backendError.providerRefused", { model: providerDetail(model) ?? "OpenCode", detail });
  return /free tier can only be used from within OpenCode/i.test(detail) ? logParts([message, "\n", logMessage("logs.backendError.providerFreeTier")]) : message;
}

// Single-line system notices render as plain text; keep provider markup literal.
export function providerRetry(message: string, attempt: number, model = "OpenCode"): LogMessage {
  const detail = providerDetail(message);
  const error = detail ? logMessage("logs.backendError.providerReported", { model: providerDetail(model) ?? "OpenCode", detail }) : providerFailureMessage({ message });
  return logMessage("logs.backend.retry", { error, attempt });
}

export function providerSignInFailure(error: SafeOpenCodeError, model = "OpenCode", needsApiKey = false) {
  const detail = providerDetail(error.message);
  const reported = detail ? logMessage("logs.backendError.providerReported", { model: providerDetail(model) ?? "OpenCode", detail }) : null;
  const message = needsApiKey
    ? reported
      ? logParts([providerFailureMessage(error), "\n", reported])
      : providerFailureMessage(error)
    : (reported ?? logMessage("logs.backendError.providerSignIn", { model: providerDetail(model) ?? "OpenCode" }));
  return { ...bureauTurnFailure(message), causedByAuth: needsApiKey, ...(!needsApiKey && !detail ? { pickModel: true } : {}) };
}
