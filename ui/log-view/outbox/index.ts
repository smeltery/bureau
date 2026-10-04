import { useSyncExternalStore } from "react";
import type { Attachment } from "../../../shared/types.ts";

export type OutboxError = { kind: "network" } | { kind: "interrupted" } | { kind: "server"; message: string };

export interface OutboxAttempt {
  id: string;
  agentId: string;
  text: string;
  attachments?: Attachment[];
  sendNow?: boolean;
  status: "pending" | "failed";
  error?: OutboxError;
  createdAt: number;
}

const KEY_PREFIX = "bureau-outbox:";
const EMPTY: OutboxAttempt[] = [];
let attempts: OutboxAttempt[] = [];
let storageUser: string | null = null;
let byAgentCache = new Map<string, OutboxAttempt[]>();
const listeners = new Set<() => void>();

function userPrefix(user: string): string {
  return `${KEY_PREFIX}${encodeURIComponent(user.toLowerCase())}:`;
}

function persist(attempt: OutboxAttempt): boolean {
  if (!storageUser || typeof localStorage === "undefined") return true;
  try {
    localStorage.setItem(userPrefix(storageUser) + attempt.id, JSON.stringify(attempt));
    return true;
  } catch {
    return false;
  }
}

function unpersist(id: string) {
  if (!storageUser || typeof localStorage === "undefined") return;
  try {
    localStorage.removeItem(userPrefix(storageUser) + id);
  } catch {}
}

function commit(next: OutboxAttempt[]) {
  attempts = next;
  byAgentCache = new Map();
  for (const listener of listeners) listener();
}

function update(id: string, patch: Partial<OutboxAttempt>) {
  const index = attempts.findIndex((attempt) => attempt.id === id);
  if (index < 0) return;
  const next = { ...attempts[index], ...patch };
  persist(next);
  commit(attempts.map((attempt, i) => (i === index ? next : attempt)));
}

function remove(id: string) {
  if (!attempts.some((attempt) => attempt.id === id)) return;
  unpersist(id);
  commit(attempts.filter((attempt) => attempt.id !== id));
}

function parseAttempt(raw: string | null): OutboxAttempt | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(raw) as Partial<OutboxAttempt>;
    if (typeof value.id !== "string" || typeof value.agentId !== "string" || typeof value.text !== "string") return null;
    if (value.attachments !== undefined && !Array.isArray(value.attachments)) return null;
    return {
      id: value.id,
      agentId: value.agentId,
      text: value.text,
      ...(value.attachments ? { attachments: value.attachments } : {}),
      ...(value.sendNow === true ? { sendNow: true } : {}),
      status: "failed",
      error: value.status === "pending" ? { kind: "interrupted" } : (value.error ?? { kind: "interrupted" }),
      createdAt: typeof value.createdAt === "number" ? value.createdAt : 0,
    };
  } catch {
    return null;
  }
}

export function restoreOutbox(user: string, liveAgentIds: ReadonlySet<string>): void {
  storageUser = user;
  if (typeof localStorage === "undefined") return;
  const prefix = userPrefix(user);
  const restored: OutboxAttempt[] = [];
  try {
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith(prefix)) continue;
      const attempt = parseAttempt(localStorage.getItem(key));
      if (!attempt || !liveAgentIds.has(attempt.agentId)) {
        localStorage.removeItem(key);
        continue;
      }
      if (!attempts.some((existing) => existing.id === attempt.id)) restored.push(attempt);
    }
  } catch {
    return;
  }
  for (const attempt of attempts) persist(attempt);
  restored.sort((a, b) => a.createdAt - b.createdAt);
  commit([...restored, ...attempts]);
}

function newId(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

async function post(attempt: OutboxAttempt) {
  try {
    const res = await fetch(`/api/agents/${encodeURIComponent(attempt.agentId)}/messages`, {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text: attempt.text,
        clientMessageId: attempt.id,
        ...(attempt.attachments ? { attachments: attempt.attachments } : {}),
        ...(attempt.sendNow ? { sendNow: true } : {}),
      }),
    });
    if (!res.ok) {
      let message = `Request failed (${res.status})`;
      try {
        const body = (await res.json()) as { error?: unknown };
        if (typeof body.error === "string") message = body.error;
      } catch {}
      throw new Error(message);
    }
    remove(attempt.id);
  } catch (err) {
    if (!attempts.some((existing) => existing.id === attempt.id)) return;
    update(attempt.id, { status: "failed", error: err instanceof Error ? { kind: "server", message: err.message } : { kind: "network" } });
  }
}

export function sendAttempt(input: { agentId: string; text: string; attachments?: Attachment[]; sendNow?: boolean }): OutboxAttempt | null {
  const attempt: OutboxAttempt = {
    id: newId(),
    agentId: input.agentId,
    text: input.text,
    ...(input.attachments && input.attachments.length > 0 ? { attachments: input.attachments } : {}),
    ...(input.sendNow ? { sendNow: true } : {}),
    status: "pending",
    createdAt: Date.now(),
  };
  if (!persist(attempt)) return null;
  commit([...attempts, attempt]);
  void post(attempt);
  return attempt;
}

export function resendAttempt(id: string): void {
  const attempt = attempts.find((existing) => existing.id === id);
  if (!attempt || attempt.status === "pending") return;
  update(id, { status: "pending", error: undefined });
  void post(attempt);
}

export function discardAttempt(id: string): void {
  remove(id);
}

export function takeAttempt(id: string): OutboxAttempt | null {
  const attempt = attempts.find((existing) => existing.id === id) ?? null;
  if (attempt) remove(id);
  return attempt;
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function outboxFor(agentId: string): OutboxAttempt[] {
  let list = byAgentCache.get(agentId);
  if (!list) {
    const filtered = attempts.filter((attempt) => attempt.agentId === agentId);
    list = filtered.length > 0 ? filtered : EMPTY;
    byAgentCache.set(agentId, list);
  }
  return list;
}

export function useOutbox(agentId: string): OutboxAttempt[] {
  return useSyncExternalStore(
    subscribe,
    () => outboxFor(agentId),
    () => EMPTY,
  );
}
