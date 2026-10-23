import { logMessage, type LogParam } from "../../../shared/i18n/log-message.ts";
import { CACHE_HIT_WARN_THRESHOLD, type UsageBucket } from "../usage-format.ts";

function fixed(value: number, digits: number): LogParam {
  // Preserve the report's existing rounding before applying locale separators.
  return { number: Number(value.toFixed(digits)), digits, group: false };
}
export function reportTokens(value: number): LogParam {
  if (value === 0) return "—";
  if (value >= 999_500) return { parts: [fixed(value / 1_000_000, 1), "M"] };
  if (value >= 1_000) return { parts: [fixed(value / 1_000, 0), "k"] };
  return { number: value };
}
export function reportUsd(value: number): LogParam {
  return value === 0 ? "—" : { parts: ["$", fixed(value, value >= 100 ? 0 : 2)] };
}
export function reportInput(bucket: UsageBucket): LogParam {
  const tokens = reportTokens(bucket.totalIn);
  const cacheable = bucket.cacheRead + bucket.cacheCreation;
  if (bucket.totalIn === 0 || cacheable === 0) return tokens;
  const percent = Math.round((bucket.cacheRead / cacheable) * 100);
  return percent >= CACHE_HIT_WARN_THRESHOLD ? tokens : logMessage("logs.report.cacheHit", { tokens, percent: { number: percent } });
}
export function reportRow(labels: LogParam[], ...buckets: UsageBucket[]): LogParam {
  const cells = [...labels, ...buckets.flatMap((bucket) => [reportInput(bucket), reportTokens(bucket.totalOut), reportUsd(bucket.costUSD)])];
  return { parts: ["| ", ...cells.flatMap((cell, index) => (index ? [" | ", cell] : [cell])), " |"] };
}
export function reportName(name: string): string {
  return name.replaceAll("\\", "\\\\").replaceAll("|", "\\|").replaceAll("\n", " ");
}
