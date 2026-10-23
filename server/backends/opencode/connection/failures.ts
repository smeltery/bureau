import type { SafeOpenCodeError } from "../parse.ts";
import { logContent, logMessage, type LogMessage } from "../../../../shared/i18n/log-message.ts";

export function providerFailure(error: SafeOpenCodeError): string {
  return logContent(providerFailureMessage(error)).content;
}

export function providerFailureMessage(error: SafeOpenCodeError): LogMessage {
  if (error.statusCode === 401 || error.statusCode === 403 || error.name === "ProviderAuthError") return logMessage("logs.provider.auth");
  const message = error.message ?? "";
  if (error.name === "ContextOverflowError" || /context.*(length|limit|window)|too many tokens/i.test(message)) return logMessage("logs.provider.context");
  if (error.statusCode === 429 || /rate.?limit/i.test(message)) return logMessage("logs.provider.rateLimit");
  if (error.statusCode === 529 || /overloaded|capacity/i.test(message)) return logMessage("logs.provider.busy");
  if (/timeout|timed out/i.test(message)) return logMessage("logs.provider.timeout");
  if (/connect|ECONN|ENOTFOUND|fetch failed/i.test(message)) return logMessage("logs.provider.connection");
  if (error.name === "MessageOutputLengthError") return logMessage("logs.provider.output");
  if (/model.*not found|configuration|invalid model/i.test(message)) return logMessage("logs.provider.model");
  if (error.statusCode) return logMessage("logs.provider.http", { status: error.statusCode });
  return logMessage("logs.provider.unknown");
}
