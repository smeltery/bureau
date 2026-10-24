import { afterEach, expect, test } from "bun:test";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import type { LogEntry } from "../../../shared/types.ts";
import { readAgentLogs } from "../../agents/log-reader.ts";
import { LOGS_DIR } from "../paths.ts";
import { listAgentSessions } from "./sessions.ts";
import { persistSessionSummary, readSessionSummary } from "./summary.ts";

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function fixture(compressed = false) {
  const agentId = `summary-${crypto.randomUUID()}`;
  const directory = join(LOGS_DIR, agentId);
  directories.push(directory);
  mkdirSync(directory, { recursive: true });
  const entries: LogEntry[] = Array.from({ length: 4 }, (_, index) => ({
    id: `entry-${index}`,
    agentId,
    kind: "text",
    timestamp: index,
    content: `Message ${index}`,
  }));
  const bytes = entries.map((entry) => JSON.stringify(entry)).join("\n");
  const path = join(directory, compressed ? "session.jsonl.gz" : "session.jsonl");
  writeFileSync(path, compressed ? gzipSync(bytes) : bytes);
  const meta = join(directory, "sessions.json");
  return { agentId, directory, entries, path, meta };
}

test("summary writes preserve ordering and unrelated metadata while allowing appended entries", () => {
  const f = fixture();
  const original = { topic: "Work", lastModified: 12, cwd: "/project", forkedFrom: "parent", usage: { costUSD: 3 } };
  writeFileSync(f.meta, JSON.stringify({ session: original, other: { topic: "Other", lastModified: 13 } }));
  const state = readSessionSummary(f.agentId, "session")!;
  writeFileSync(f.path, [...f.entries, { ...f.entries[0], id: "appended" }].map((entry) => JSON.stringify(entry)).join("\n"));
  expect(persistSessionSummary(f.agentId, "session", state, "Useful paragraph", "entry-3")).toBe(true);
  const saved = JSON.parse(readFileSync(f.meta, "utf8"));
  expect(saved.session).toMatchObject({ ...original, summary: "Useful paragraph", summaryThroughEntryId: "entry-3" });
  expect(saved.session.summaryAt).toBeGreaterThan(0);
  expect(saved.other).toEqual({ topic: "Other", lastModified: 13 });
  expect(listAgentSessions(f.agentId)[0]).toMatchObject({ lastModified: 12, summary: "Useful paragraph" });
  expect(persistSessionSummary(f.agentId, "session", state, "Stale result", "entry-3")).toBe(false);
});

test("compressed branch logs stay local and legacy history keeps its timestamp", () => {
  const f = fixture(true);
  const modified = statSync(f.path).mtimeMs;
  writeFileSync(join(f.directory, "parent.jsonl"), JSON.stringify({ ...f.entries[0], id: "ancestor" }));
  const state = readSessionSummary(f.agentId, "session")!;
  expect(state.entries.map((entry) => entry.id)).toEqual(f.entries.map((entry) => entry.id));
  expect(persistSessionSummary(f.agentId, "session", state, "Compressed history", "entry-3")).toBe(true);
  expect(JSON.parse(readFileSync(f.meta, "utf8")).session.lastModified).toBe(modified);
});

test("deleted or rewritten transcripts reject late results without recreating storage", () => {
  for (const removeDirectory of [false, true]) {
    const f = fixture();
    const state = readSessionSummary(f.agentId, "session")!;
    rmSync(removeDirectory ? f.directory : f.path, { recursive: true });
    expect(persistSessionSummary(f.agentId, "session", state, "Late", "entry-3")).toBe(false);
    expect(readSessionSummary(f.agentId, "session")).toBeNull();
    expect(existsSync(f.meta)).toBe(false);
    if (removeDirectory) expect(existsSync(f.directory)).toBe(false);
  }
  const f = fixture();
  const state = readSessionSummary(f.agentId, "session")!;
  writeFileSync(f.path, f.entries.map((entry) => JSON.stringify({ ...entry, content: "Edited" })).join("\n"));
  expect(persistSessionSummary(f.agentId, "session", state, "Outdated", "entry-3")).toBe(false);
  expect(existsSync(f.meta)).toBe(false);
});

test("corrupt metadata and write failures remain visible and are never overwritten", () => {
  const f = fixture();
  const state = readSessionSummary(f.agentId, "session")!;
  for (const raw of ["{broken", "null", "[]", '{"session":null}']) {
    writeFileSync(f.meta, raw);
    expect(() => readSessionSummary(f.agentId, "session")).toThrow();
    expect(() => persistSessionSummary(f.agentId, "session", state, "Result", "entry-3")).toThrow();
    expect(readFileSync(f.meta, "utf8")).toBe(raw);
  }
  writeFileSync(f.meta, "{}");
  mkdirSync(`${f.meta}.tmp`);
  expect(() => persistSessionSummary(f.agentId, "session", state, "Result", "entry-3")).toThrow();
  expect(readFileSync(f.meta, "utf8")).toBe("{}");
});

test("history exposes summaries and searches them independently of entry filters", () => {
  const f = fixture();
  writeFileSync(f.meta, JSON.stringify({ session: { topic: "Launch plan", lastModified: 100 } }));
  const state = readSessionSummary(f.agentId, "session")!;
  expect(persistSessionSummary(f.agentId, "session", state, "Resolved the deployment failure", "entry-3")).toBe(true);
  const read = (query: string) => readAgentLogs(f.agentId, new URLSearchParams(query));
  expect(read("")).toMatchObject({ ok: true, body: { mode: "index", truncated: false, sessions: [{ summary: "Resolved the deployment failure" }] } });
  for (const query of ["session=session", "session=session&around=entry-2"]) {
    expect(read(query)).toMatchObject({ ok: true, body: { mode: "retrieve", summary: "Resolved the deployment failure" } });
  }
  for (const query of ["q=deployment&kind=tool_call", "q=LAUNCH&tier=prompts", "q=deploy.*failure&regex=1&session=session&after=100&before=100"]) {
    expect(read(query)).toMatchObject({ ok: true, body: { mode: "search", totalMatches: 0, results: [], summaryHits: [{ sessionId: "session", topic: "Launch plan", lastModified: 100 }] } });
  }
  for (const query of ["q=deployment&after=101", "q=deployment&before=99"]) {
    expect(read(query)).toMatchObject({ ok: true, body: { summaryHits: [] } });
  }
  expect(read("q=deployment&session=missing")).toMatchObject({ ok: false, status: 404 });
  writeFileSync(join(f.directory, "older.jsonl"), JSON.stringify(f.entries[0]));
  const map = JSON.parse(readFileSync(f.meta, "utf8"));
  map.older = { topic: "Older launch", lastModified: 50 };
  writeFileSync(f.meta, JSON.stringify(map));
  expect(read("limit=1")).toMatchObject({ ok: true, body: { truncated: true, sessions: [{ sessionId: "session" }] } });
  expect(read("limit=1&before=99")).toMatchObject({ ok: true, body: { truncated: false, sessions: [{ sessionId: "older" }] } });
});
