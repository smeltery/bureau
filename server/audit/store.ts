import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, relative } from "node:path";
import { auditContext } from "./context.ts";

import type { AuditEntry } from "../../shared/integrations/audit.ts";

const root = () => process.env.BUREAU_HOME?.trim() || join(homedir(), ".bureau");
const directory = () => join(root(), "audit");
const FIELD_NAMES = new Set([
  "name",
  "title",
  "description",
  "status",
  "priority",
  "assignee",
  "roomId",
  "room",
  "role",
  "allowedRooms",
  "memberPrompt",
  "envFile",
  "language",
  "avatarColor",
  "avatarVariant",
  "task",
  "history",
  "agents",
  "rooms",
  "command",
  "cwd",
  "createdByAgentId",
  "archivedAt",
  "enabled",
  "schedule",
  "prompt",
  "publicOrigin",
  "externalAccess",
  "permissions",
  "modelFamily",
  "effort",
  "privileged",
]);

function persist(entry: AuditEntry) {
  mkdirSync(directory(), { recursive: true, mode: 0o700 });
  const path = join(directory(), `${entry.id}.json`);
  writeFileSync(`${path}.tmp`, JSON.stringify(entry), { mode: 0o600 });
  renameSync(`${path}.tmp`, path);
}
function changedFields(before: string | null, after: string): string[] {
  try {
    const a = before === null ? {} : JSON.parse(before);
    const b = JSON.parse(after);
    const fields = new Set<string>();
    function visit(left: any, right: any, depth: number) {
      if (depth > 3 || (!left && !right)) return;
      for (const key of new Set([...Object.keys(left ?? {}), ...Object.keys(right ?? {})])) {
        if (JSON.stringify(left?.[key]) === JSON.stringify(right?.[key])) continue;
        if (FIELD_NAMES.has(key)) fields.add(key);
        if (typeof left?.[key] === "object" || typeof right?.[key] === "object") visit(left?.[key], right?.[key], depth + 1);
      }
    }
    visit(a, b, 0);
    return fields.size ? [...fields] : ["content"];
  } catch {
    return ["content"];
  }
}

/** Record intent before a state write, so interrupted writes remain explicitly uncertain. */
export function auditFileWrite(path: string, data: string | Buffer, write: () => void): void {
  const context = auditContext.getStore();
  const target = relative(root(), path);
  if (!context || context.closed || target.startsWith("..") || target.startsWith("audit/") || target.startsWith("logs/") || target.endsWith(".tmp")) return write();
  const after = data.toString();
  const before = existsSync(path) ? readFileSync(path, "utf8") : null;
  if (before === after) return write();
  const entry: AuditEntry = {
    actor: context.actor,
    operation: context.operation,
    id: `${Date.now().toString().padStart(13, "0")}-${crypto.randomUUID()}`,
    at: Date.now(),
    target,
    fields: changedFields(before, after),
    outcome: "pending",
  };
  persist(entry);
  try {
    write();
  } catch (error) {
    entry.outcome = "failed";
    try {
      persist(entry);
    } catch (auditError) {
      console.error("[audit] could not finalize failed write", auditError);
    }
    throw error;
  }
  entry.outcome = "committed";
  try {
    persist(entry);
  } catch (error) {
    console.error("[audit] state committed; audit outcome remains pending", error);
  }
}

export function recordAuditEvent(target: string, fields: string[] = []): void {
  const context = auditContext.getStore();
  if (!context || context.closed) return;
  try {
    persist({ actor: context.actor, operation: context.operation, id: `${Date.now().toString().padStart(13, "0")}-${crypto.randomUUID()}`, at: Date.now(), target, fields, outcome: "committed" });
  } catch (error) {
    console.error("[audit] unable to record completed event", error);
  }
}

export function readAuditPage(options: { cursor?: string; actor?: string; operation?: string } = {}) {
  if (options.cursor && !/^\d{13}-[a-f0-9-]{36}$/.test(options.cursor)) throw new Error("invalid cursor");
  const names = existsSync(directory())
    ? readdirSync(directory())
        .filter((name) => /^\d{13}-[a-f0-9-]{36}\.json$/.test(name))
        .sort()
        .reverse()
    : [];
  const entries: AuditEntry[] = [];
  for (const name of names) {
    if (options.cursor && name.slice(0, -5) >= options.cursor) continue;
    const entry = JSON.parse(readFileSync(join(directory(), name), "utf8")) as AuditEntry;
    if (options.actor && !entry.actor.toLowerCase().includes(options.actor.toLowerCase())) continue;
    if (options.operation && !entry.operation.toLowerCase().includes(options.operation.toLowerCase())) continue;
    entries.push(entry);
    if (entries.length === 51) break;
  }
  return { entries: entries.slice(0, 50), nextCursor: entries.length > 50 ? entries[49]!.id : null };
}
