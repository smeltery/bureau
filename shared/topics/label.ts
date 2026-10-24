export function normalizeTopic(value: unknown): string | null {
  const label = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : null;
  return !label || label === "..." ? null : Array.from(label).slice(0, 80).join("");
}
