import type { SafeOpenCodeError } from "../parse.ts";
import { OPENCODE_AUTH_FAILURE } from "../config.ts";

export function providerFailure(error: SafeOpenCodeError): string {
  if (error.statusCode === 401 || error.statusCode === 403 || error.name === "ProviderAuthError") return OPENCODE_AUTH_FAILURE;
  const message = error.message ?? "";
  if (error.name === "ContextOverflowError" || /context.*(length|limit|window)|too many tokens/i.test(message)) return "OpenCode could not fit the conversation into the model's context window.";
  if (error.statusCode === 429 || /rate.?limit/i.test(message)) return "The model provider is rate limiting requests. Try again shortly.";
  if (error.statusCode === 529 || /overloaded|capacity/i.test(message)) return "The model provider is busy. Try again shortly.";
  if (/timeout|timed out/i.test(message)) return "The model provider did not respond in time.";
  if (/connect|ECONN|ENOTFOUND|fetch failed/i.test(message)) return "OpenCode could not connect to the model provider.";
  if (error.name === "MessageOutputLengthError") return "The response reached the model's output limit.";
  if (/model.*not found|configuration|invalid model/i.test(message)) return "OpenCode could not use the configured model. Check the provider and model settings.";
  if (error.statusCode) return `The model provider returned HTTP ${error.statusCode}.`;
  return "OpenCode reported a provider or transport error.";
}
