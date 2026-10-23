export const DEFAULT_HANDOFF_TOKENS = 500_000;
export const MIN_HANDOFF_TOKENS = 50_000;
export const MAX_HANDOFF_TOKENS = 10_000_000;

export function validHandoffTokens(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= MIN_HANDOFF_TOKENS && value <= MAX_HANDOFF_TOKENS;
}

export function handoffTokens(value: unknown): number {
  return validHandoffTokens(value) ? value : DEFAULT_HANDOFF_TOKENS;
}

export function handoffSettingsError(settings: { autoHandoff?: unknown; autoHandoffTokens?: unknown }): string | null {
  if (settings.autoHandoff !== undefined && typeof settings.autoHandoff !== "boolean") return "autoHandoff must be a boolean";
  if (settings.autoHandoffTokens !== undefined && !validHandoffTokens(settings.autoHandoffTokens))
    return `Token limit must be a whole number from ${MIN_HANDOFF_TOKENS.toLocaleString("en-US")} to ${MAX_HANDOFF_TOKENS.toLocaleString("en-US")}`;
  return null;
}
