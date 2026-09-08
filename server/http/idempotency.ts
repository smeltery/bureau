// Small in-memory Idempotency-Key cache for mutating API-token routes.
// Keys by subject + op + key + body hash; TTL 5 minutes. Failures are not cached.

import { createHash } from "crypto";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export type CachedHttp = { status: number; body: string };

export type IdempotencyOutcome<R> = { kind: "ran"; response: R } | { kind: "replayed"; response: R } | { kind: "conflict" };

interface PendingEntry {
  state: "pending";
  bodyHash: string;
  promise: Promise<unknown>;
}
interface DoneEntry {
  state: "done";
  bodyHash: string;
  response: unknown;
  expiresAt: number;
}
type Entry = PendingEntry | DoneEntry;

export interface IdempotencyCache {
  run<R>(args: { subject: string; op: string; idempotencyKey: string | null; rawBody: string }, handler: () => Promise<R>): Promise<IdempotencyOutcome<R>>;
  _reset(): void;
}

export function hashBody(rawBody: string): string {
  return createHash("sha256").update(rawBody).digest("hex");
}

export function createIdempotencyCache(opts: { now?: () => number; ttlMs?: number } = {}): IdempotencyCache {
  const now = opts.now ?? Date.now;
  const ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS;
  const store = new Map<string, Entry>();

  function composeKey(subject: string, op: string, key: string): string {
    return `${subject}\u0000${op}\u0000${key}`;
  }

  function prune(t: number): void {
    for (const [k, e] of store) {
      if (e.state === "done" && e.expiresAt <= t) store.delete(k);
    }
  }

  async function run<R>(args: { subject: string; op: string; idempotencyKey: string | null; rawBody: string }, handler: () => Promise<R>): Promise<IdempotencyOutcome<R>> {
    if (!args.idempotencyKey) return { kind: "ran", response: await handler() };

    const t = now();
    prune(t);
    const bodyHash = hashBody(args.rawBody);
    const cacheKey = composeKey(args.subject, args.op, args.idempotencyKey);
    const existing = store.get(cacheKey);
    if (existing) {
      if (existing.bodyHash !== bodyHash) return { kind: "conflict" };
      if (existing.state === "pending") return { kind: "replayed", response: (await existing.promise) as R };
      return { kind: "replayed", response: existing.response as R };
    }

    const promise = handler();
    store.set(cacheKey, { state: "pending", bodyHash, promise });
    try {
      const response = await promise;
      store.set(cacheKey, { state: "done", bodyHash, response, expiresAt: now() + ttlMs });
      return { kind: "ran", response };
    } catch (err) {
      const cur = store.get(cacheKey);
      if (cur?.state === "pending") store.delete(cacheKey);
      throw err;
    }
  }

  return { run, _reset: () => store.clear() };
}

export const apiTokenIdempotency = createIdempotencyCache();

export function cachedJson(status: number, body: unknown): CachedHttp {
  return { status, body: JSON.stringify(body) };
}

export function idempotencyToResponse(outcome: IdempotencyOutcome<CachedHttp>): Response {
  if (outcome.kind === "conflict") {
    return new Response(JSON.stringify({ error: "Idempotency-Key reused with a different request body" }), { status: 409, headers: JSON_HEADERS });
  }
  const headers: Record<string, string> = { ...JSON_HEADERS };
  if (outcome.kind === "replayed") headers["Idempotency-Replayed"] = "true";
  return new Response(outcome.response.body, { status: outcome.response.status, headers });
}

export function readIdempotencyKey(req: Request): string | null {
  return req.headers.get("Idempotency-Key")?.trim() || null;
}
