import type { LogEntry } from "../../../shared/types.ts";

// Generic assignment names ignore case; provider prefixes remain case-sensitive.
// A single pass means one match cannot consume the replacement of another
// overlapping match.
const SECRET_PATTERN =
  /sk-proj-[A-Za-z0-9_-]{20,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{20,}|whsec_[A-Za-z0-9+/=]{20,}|sk-ant-api03-[A-Za-z0-9_-]{20,}|sk-[A-Za-z0-9]{20,}|m0-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{82}|AKIA[0-9A-Z]{16}|(?i:(api[_-]?key|secret|token|password)\s*[=:]\s*['"]?)([A-Za-z0-9_\-+/.=]{16,})/g;

/** Copy an entry without changing the producer's payload. Keys are structural;
 * string values (including nested payloads and metadata) are scanned. */
export function redactLogEntry<T extends object = LogEntry>(entry: T): T {
  const seen = new WeakMap<object, object>();
  const pending: { source: object; target: object }[] = [];
  function copy(value: unknown): unknown {
    if (typeof value === "string") {
      // A bare key keeps its first eight characters. A KEY=value assignment
      // keeps the label and the value's first eight characters, so the
      // reader still sees which key it was.
      return value.replace(SECRET_PATTERN, (match, _label: string | undefined, assigned: string | undefined) =>
        assigned === undefined ? match.slice(0, 8) + "...REDACTED" : match.slice(0, match.length - assigned.length) + assigned.slice(0, 8) + "...REDACTED",
      );
    }
    if (value === null || typeof value !== "object") return value;
    if (seen.has(value)) return seen.get(value);
    const target = Array.isArray(value) ? new Array(value.length) : {};
    seen.set(value, target);
    pending.push({ source: value, target });
    return target;
  }
  const result = copy(entry) as T;
  // An explicit stack handles deeply nested payloads without call-stack limits.
  while (pending.length > 0) {
    const { source, target } = pending.pop()!;
    for (const [key, child] of Object.entries(source)) {
      Object.defineProperty(target, key, {
        value: copy(child),
        enumerable: true,
        configurable: true,
        writable: true,
      });
    }
  }
  return result;
}

// Returned entries are owned by persistence and must remain immutable,
// including their nested payloads. Managers reuse them for cache, events and
// disk backfill. A memo miss only costs another scan.
const preparedLogEntries = new WeakSet<LogEntry>();

// Failure must not drop the entry or print the failed payload/exception.
export function prepareLogEntry(entry: LogEntry): LogEntry {
  if (preparedLogEntries.has(entry)) return entry;
  try {
    const scanned = redactLogEntry(entry);
    const out = scanned === entry ? { ...entry } : scanned;
    preparedLogEntries.add(out);
    return out;
  } catch {
    console.error("Log secret redaction failed; keeping original entry.", entry.id, entry.kind);
    return entry;
  }
}
