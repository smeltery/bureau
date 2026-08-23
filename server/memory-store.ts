import { appendFileSync, mkdirSync, readFileSync } from "fs";
import { createHash } from "crypto";
import { dirname, join } from "path";
import { atomicWriteFileSync, BUREAU_DIR } from "./persistence.ts";
import { injectedMemorySize, type MemoryItem, type MemoryScope } from "../shared/types.ts";

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export function isSafeScopeId(id: string): boolean {
  return SAFE_ID.test(id);
}

export function formatMemoryLine(input: { author: string | null; date: string; text: string }): string {
  return input.author === null ? `- ${input.date}: ${input.text}` : `- ${input.author}, ${input.date}: ${input.text}`;
}

const AUTHORLESS_LINE_RE = /^- (\d{4}-\d{2}-\d{2}): (.*\S)\s*$/;
const AUTHORED_LINE_RE = /^- (.+?), (\d{4}-\d{2}-\d{2}): (.*\S)\s*$/;

export function parseMemoryLine(raw: string, scope: MemoryScope, scopeId: string | null): MemoryItem | null {
  const bare = AUTHORLESS_LINE_RE.exec(raw);
  const match = bare ?? AUTHORED_LINE_RE.exec(raw);
  if (!match) return null;
  return {
    scope,
    scopeId,
    author: bare ? null : match[1],
    date: bare ? match[1] : match[2],
    text: bare ? match[2] : match[3],
    raw: raw.replace(/\s+$/, ""),
  };
}

export function normalizeForDedup(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.,;:!?]+$/u, "")
    .trim();
}

export function isExactDuplicateText(text: string, existing: string): boolean {
  return normalizeForDedup(text) === normalizeForDedup(existing);
}

export const MEMORY_CAPS: Record<MemoryScope, number> = {
  office: 2500,
  room: 3500,
  agent: 5000,
  boss: 5000,
};

export const OVER_CAP_NOTICE = "Not all memories fit. Ask the boss to trim them.";

export function injectedSize(text: string): number {
  return injectedMemorySize(text);
}

export function renderCapped(lines: readonly string[], cap: number): string {
  const full = lines.join("\n");
  if (full.length <= cap) return full;
  const kept: string[] = [];
  let size = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const add = lines[i].length + (kept.length ? 1 : 0);
    if (size + add > cap) break;
    kept.push(lines[i]);
    size += add;
  }
  kept.reverse();
  const body = kept.join("\n");
  return body.length ? `${body}\n${OVER_CAP_NOTICE}` : OVER_CAP_NOTICE;
}

export function versionOf(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex").slice(0, 12);
}

export interface MemoryScopeRef {
  scope: MemoryScope;
  scopeId: string | null;
  label: string;
}

export interface MemoryReadResult {
  text: string;
  version: string;
}

export interface MemoryAppendResult {
  item: MemoryItem;
  version: string;
}

export type MemoryReplaceResult = { ok: true; version: string } | { ok: false; conflict: true; version: string };

export interface MemoryStore {
  read(scope: MemoryScope, scopeId: string | null): MemoryReadResult;
  readText(scope: MemoryScope, scopeId: string | null): string;
  append(input: { scope: MemoryScope; scopeId: string | null; author: string; authorAgentId?: string | null; text: string }): MemoryAppendResult;
  replace(input: { scope: MemoryScope; scopeId: string | null; text: string; author: string; expectedVersion?: string | null }): MemoryReplaceResult;
  findDuplicate(scope: MemoryScope, scopeId: string | null, text: string): MemoryItem | null;
  renderForPrompt(scope: MemoryScope, scopeId: string | null): string | null;
  renderForPromptMulti(refs: readonly MemoryScopeRef[]): string | null;
}

export interface MemoryStoreDeps {
  stateRoot?: string;
  today?: () => string;
  now?: () => string;
  caps?: Record<MemoryScope, number>;
}

export function createMemoryStore(deps: MemoryStoreDeps = {}): MemoryStore {
  const stateRoot = deps.stateRoot ?? BUREAU_DIR;
  const today = deps.today ?? (() => new Date().toISOString().slice(0, 10));
  const now = deps.now ?? (() => new Date().toISOString());
  const caps = deps.caps ?? MEMORY_CAPS;

  function filePath(scope: MemoryScope, scopeId: string | null): string {
    const base = join(stateRoot, "memory");
    switch (scope) {
      case "office":
        return join(base, "office.md");
      case "room":
        return join(base, "rooms", `${scopeId}.md`);
      case "agent":
        return join(base, "agents", `${scopeId}.md`);
      case "boss":
        return join(base, "bosses", `${scopeId}.md`);
    }
  }

  function readText(scope: MemoryScope, scopeId: string | null): string {
    try {
      return readFileSync(filePath(scope, scopeId), "utf8");
    } catch {
      return "";
    }
  }

  function read(scope: MemoryScope, scopeId: string | null): MemoryReadResult {
    const text = readText(scope, scopeId);
    return { text, version: versionOf(text) };
  }

  function logOp(entry: Record<string, unknown>): void {
    const path = join(stateRoot, "memory", ".oplog.jsonl");
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, JSON.stringify(entry) + "\n");
  }

  function append(input: { scope: MemoryScope; scopeId: string | null; author: string; authorAgentId?: string | null; text: string }): MemoryAppendResult {
    const date = today();
    const selfAuthored = input.scope === "agent" && !!input.authorAgentId && input.authorAgentId === input.scopeId;
    const line = formatMemoryLine({ author: selfAuthored ? null : input.author, date, text: input.text });
    const path = filePath(input.scope, input.scopeId);
    mkdirSync(dirname(path), { recursive: true });
    appendFileSync(path, line + "\n");
    const content = readText(input.scope, input.scopeId);
    const version = versionOf(content);
    logOp({ ts: now(), actor: input.author, scope: input.scope, scopeId: input.scopeId, op: "append", text: input.text, content, version });
    return { item: { scope: input.scope, scopeId: input.scopeId, author: selfAuthored ? null : input.author, date, text: input.text, raw: line }, version };
  }

  function replace(input: { scope: MemoryScope; scopeId: string | null; text: string; author: string; expectedVersion?: string | null }): MemoryReplaceResult {
    const current = readText(input.scope, input.scopeId);
    const currentVersion = versionOf(current);
    if (input.expectedVersion != null && input.expectedVersion !== currentVersion) {
      return { ok: false, conflict: true, version: currentVersion };
    }
    const path = filePath(input.scope, input.scopeId);
    mkdirSync(dirname(path), { recursive: true });
    atomicWriteFileSync(path, input.text);
    const version = versionOf(input.text);
    logOp({ ts: now(), actor: input.author, scope: input.scope, scopeId: input.scopeId, op: "replace", text: "(full rewrite)", content: input.text, version, previousVersion: currentVersion });
    return { ok: true, version };
  }

  function findDuplicate(scope: MemoryScope, scopeId: string | null, text: string): MemoryItem | null {
    for (const line of readText(scope, scopeId).split("\n")) {
      const item = parseMemoryLine(line, scope, scopeId);
      if (item && isExactDuplicateText(text, item.text)) return item;
    }
    return null;
  }

  function renderForPrompt(scope: MemoryScope, scopeId: string | null): string | null {
    const lines = readText(scope, scopeId)
      .split("\n")
      .filter((line) => line.trim() !== "");
    if (lines.length === 0) return null;
    return renderCapped(lines, caps[scope]);
  }

  function renderForPromptMulti(refs: readonly MemoryScopeRef[]): string | null {
    const blocks: string[] = [];
    for (const ref of refs) {
      const body = renderForPrompt(ref.scope, ref.scopeId);
      if (body) blocks.push(`${ref.label}:\n${body}`);
    }
    return blocks.length > 0 ? blocks.join("\n\n") : null;
  }

  return { read, readText, append, replace, findDuplicate, renderForPrompt, renderForPromptMulti };
}

export const memoryStore = createMemoryStore();
