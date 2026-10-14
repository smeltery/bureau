/** Mirror OpenCode's default compaction reserve, including configured overrides. */
export function compactionThreshold(limits: { context: number; input?: number; output?: number }, config: unknown, outputOverride?: string): number | undefined {
  const settings = config && typeof config === "object" ? (config as Record<string, unknown>) : {};
  if (settings.auto === false) return undefined;
  const override = Number(outputOverride);
  const outputCap = Number.isFinite(override) && override > 0 ? override : 32_000;
  const maxOutput = Math.min(limits.output || outputCap, outputCap);
  const reserved = typeof settings.reserved === "number" && settings.reserved >= 0 ? settings.reserved : 20_000;
  return Math.max(0, limits.input ? limits.input - Math.min(reserved, maxOutput) : limits.context - maxOutput);
}
