import { loadLog, loadLogWithAncestors } from "../persistence/logs/logs.ts";
import { listAgentSessions } from "../persistence/logs/sessions.ts";
import type { LogEntry } from "../../shared/types.ts";

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 200;
const MAX_QUERY_LENGTH = 500;
const MAX_PATTERN_LENGTH = 200;
const DEFAULT_WINDOW = 5;
const MAX_WINDOW = 50;
const SNIPPET_RADIUS = 80;
const MAX_SNIPPET = 220;
const ALL_KINDS = [
  "text",
  "thinking",
  "tool_call",
  "tool_result",
  "error",
  "system",
  "user_message",
  "diff",
  "edit-request",
  "terminal-command",
  "file-view",
] as const satisfies readonly LogEntry["kind"][];
const KIND_SET = new Set<LogEntry["kind"]>(ALL_KINDS);
const TIER_KINDS = {
  prompts: new Set<LogEntry["kind"]>(["user_message"]),
  conversation: new Set<LogEntry["kind"]>(["user_message", "text"]),
  full: null,
} as const;

export interface LogSessionSummary {
  sessionId: string;
  topic: string | null;
  lastModified: number;
  cwd: string | null;
  forked: boolean;
  branched: boolean;
}

export interface LogSearchHit {
  sessionId: string;
  sessionTopic: string | null;
  entryId: string;
  kind: LogEntry["kind"];
  timestamp: number;
  snippet: string;
}

export type LogReadResult =
  | { ok: true; body: { mode: "index"; sessions: LogSessionSummary[] } }
  | { ok: true; body: { mode: "search"; query: string; totalMatches: number; results: LogSearchHit[] } }
  | { ok: true; body: { mode: "retrieve"; sessionId: string; entries: LogEntry[] } }
  | { ok: false; status: number; error: string };

interface TimestampBounds {
  before: number | null;
  after: number | null;
}

interface SearchMatcher {
  regex: boolean;
  query: string;
  pattern: RegExp | null;
}

export function readAgentLogs(agentId: string, query: URLSearchParams): LogReadResult {
  const limit = parseLimit(query.get("limit"));
  if (typeof limit === "string") return { ok: false, status: 422, error: limit };

  const q = query.get("q");
  const sessionId = query.get("session");
  const around = query.get("around");
  const window = parseWindow(query.get("window"));
  const kinds = parseKindSelection(query);
  const before = parseTimestampBound(query.get("before"), "before");
  const after = parseTimestampBound(query.get("after"), "after");
  const matcher = parseSearchMatcher(q, query.get("regex"));
  if (q !== null && q.trim() === "") return { ok: false, status: 422, error: "q must not be empty" };
  if (sessionId !== null && !isSafeId(sessionId)) return { ok: false, status: 404, error: "session not found" };
  if (around !== null && (q !== null || sessionId === null)) return { ok: false, status: 422, error: "around requires session and cannot be combined with q" };
  if (around !== null && !isSafeId(around)) return { ok: false, status: 404, error: "entry not found" };
  if (typeof window === "string") return { ok: false, status: 422, error: window };
  if (typeof kinds === "string") return { ok: false, status: 422, error: kinds };
  if (typeof before === "string") return { ok: false, status: 422, error: before };
  if (typeof after === "string") return { ok: false, status: 422, error: after };
  if (typeof matcher === "string") return { ok: false, status: 422, error: matcher };
  const bounds = { before, after };

  const sessions = listAgentSessions(agentId);
  if (matcher !== null) return searchAgentLogs(agentId, sessions, matcher, sessionId, limit, kinds, bounds);
  if (sessionId !== null) return retrieveAgentLog(agentId, sessions, sessionId, limit, around, window, kinds, bounds);

  return {
    ok: true,
    body: {
      mode: "index",
      sessions: sessions.slice(0, limit).map((session) => ({
        sessionId: session.sessionId,
        topic: session.topic,
        lastModified: session.lastModified,
        cwd: session.cwd,
        forked: session.forked === true,
        branched: session.branched === true,
      })),
    },
  };
}

function searchAgentLogs(
  agentId: string,
  sessions: ReturnType<typeof listAgentSessions>,
  matcher: SearchMatcher,
  sessionId: string | null,
  limit: number,
  kinds: Set<LogEntry["kind"]> | null,
  bounds: TimestampBounds,
): LogReadResult {
  const searchable = sessionId === null ? sessions : sessions.filter((session) => session.sessionId === sessionId);
  if (sessionId !== null && searchable.length === 0) return { ok: false, status: 404, error: "session not found" };

  const results: LogSearchHit[] = [];
  let totalMatches = 0;
  for (const session of searchable) {
    for (const entry of loadLog(agentId, session.sessionId)) {
      if (!kindAllowed(entry.kind, kinds)) continue;
      if (!withinTimestampBounds(entry, bounds)) continue;
      const content = entry.content ?? "";
      const match = findMatch(content, matcher);
      if (!match) continue;
      totalMatches += 1;
      if (results.length < limit) {
        results.push({
          sessionId: session.sessionId,
          sessionTopic: session.topic,
          entryId: entry.id,
          kind: entry.kind,
          timestamp: entry.timestamp,
          snippet: snippet(content, match.index, match.length),
        });
      }
    }
  }
  results.sort((a, b) => b.timestamp - a.timestamp);
  return { ok: true, body: { mode: "search", query: matcher.query, totalMatches, results } };
}

function retrieveAgentLog(
  agentId: string,
  sessions: ReturnType<typeof listAgentSessions>,
  sessionId: string,
  limit: number,
  around: string | null,
  window: number,
  kinds: Set<LogEntry["kind"]> | null,
  bounds: TimestampBounds,
): LogReadResult {
  if (!sessions.some((session) => session.sessionId === sessionId)) return { ok: false, status: 404, error: "session not found" };
  const entries = loadLogWithAncestors(agentId, sessionId).filter((entry) => withinTimestampBounds(entry, bounds));
  if (around !== null) {
    const filtered = entries.filter((entry) => kindAllowed(entry.kind, kinds) || entry.id === around);
    const index = filtered.findIndex((entry) => entry.id === around);
    if (index === -1) return { ok: false, status: 404, error: "entry not found" };
    return { ok: true, body: { mode: "retrieve", sessionId, entries: filtered.slice(Math.max(0, index - window), index + window + 1) } };
  }
  const filtered = entries.filter((entry) => kindAllowed(entry.kind, kinds));
  return { ok: true, body: { mode: "retrieve", sessionId, entries: filtered.slice(-limit) } };
}

function parseLimit(raw: string | null): number | string {
  if (raw === null) return DEFAULT_LIMIT;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_LIMIT) return `limit must be an integer between 1 and ${MAX_LIMIT}`;
  return n;
}

function parseTimestampBound(raw: string | null, name: "before" | "after"): number | string | null {
  if (raw === null) return null;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 0) return `${name} must be a nonnegative integer timestamp`;
  return n;
}

function parseSearchMatcher(q: string | null, regexRaw: string | null): SearchMatcher | string | null {
  if (q === null) return null;
  const regex = isTruthyFlag(regexRaw);
  const max = regex ? MAX_PATTERN_LENGTH : MAX_QUERY_LENGTH;
  if (q.length > max) return `q must be at most ${max} characters${regex ? " when regex=1" : ""}`;
  if (!regex) return { regex: false, query: q, pattern: null };
  try {
    return { regex: true, query: q, pattern: new RegExp(q, "i") };
  } catch {
    return "q is not a valid regular expression";
  }
}

function isTruthyFlag(raw: string | null): boolean {
  return raw === "1" || raw === "true" || raw === "yes";
}

function parseWindow(raw: string | null): number | string {
  if (raw === null) return DEFAULT_WINDOW;
  const n = Number(raw);
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_WINDOW) return `window must be an integer between 1 and ${MAX_WINDOW}`;
  return n;
}

function parseKindSelection(query: URLSearchParams): Set<LogEntry["kind"]> | null | string {
  const tierRaw = query.get("tier");
  if (tierRaw !== null && !(tierRaw in TIER_KINDS)) return `tier must be one of: ${Object.keys(TIER_KINDS).join(", ")}`;

  const kindRaw = query.get("kind");
  if (kindRaw === null) return TIER_KINDS[(tierRaw as keyof typeof TIER_KINDS | null) ?? "conversation"];

  const parts = kindRaw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  if (parts.length === 0) return "kind must not be empty";

  const selected = new Set<LogEntry["kind"]>();
  for (const part of parts) {
    if (!KIND_SET.has(part as LogEntry["kind"])) return `kind must be a comma-separated subset of: ${ALL_KINDS.join(", ")}`;
    selected.add(part as LogEntry["kind"]);
  }
  return selected;
}

function kindAllowed(kind: LogEntry["kind"], kinds: Set<LogEntry["kind"]> | null): boolean {
  return kinds === null || kinds.has(kind);
}

function withinTimestampBounds(entry: LogEntry, bounds: TimestampBounds): boolean {
  if (bounds.after !== null && entry.timestamp < bounds.after) return false;
  if (bounds.before !== null && entry.timestamp > bounds.before) return false;
  return true;
}

function findMatch(content: string, matcher: SearchMatcher): { index: number; length: number } | null {
  if (matcher.pattern) {
    matcher.pattern.lastIndex = 0;
    const match = matcher.pattern.exec(content);
    return match ? { index: match.index, length: match[0].length } : null;
  }
  const index = content.toLocaleLowerCase().indexOf(matcher.query.toLocaleLowerCase());
  return index === -1 ? null : { index, length: matcher.query.length };
}

function isSafeId(value: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(value);
}

function snippet(content: string, matchIndex: number, matchLength: number): string {
  const start = Math.max(0, matchIndex - SNIPPET_RADIUS);
  const end = Math.min(content.length, matchIndex + matchLength + SNIPPET_RADIUS);
  const text = content.slice(start, end).replace(/\s+/g, " ").trim();
  const clipped = text.length > MAX_SNIPPET ? text.slice(0, MAX_SNIPPET).trimEnd() : text;
  return `${start > 0 ? "..." : ""}${clipped}${end < content.length ? "..." : ""}`;
}
