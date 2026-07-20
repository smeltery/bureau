import type { ServerWebSocket } from "bun";
import type { SessionContext, SessionWire, UserRecord } from "../shared/types.ts";

const wsUsers = new WeakMap<ServerWebSocket<unknown>, UserRecord>();
const sessionPrefixes = new WeakMap<ServerWebSocket<unknown>, string>();
const connectedAt = new WeakMap<ServerWebSocket<unknown>, number>();
const lastSeenAt = new WeakMap<ServerWebSocket<unknown>, number>();
const activeSockets = new Set<ServerWebSocket<unknown>>();

export function bindWsUser(ws: ServerWebSocket<unknown>, user: UserRecord): void {
  wsUsers.set(ws, user);
  activeSockets.add(ws);
  if (!sessionPrefixes.has(ws)) sessionPrefixes.set(ws, Math.random().toString(16).slice(2, 10).padEnd(8, "0"));
  if (!connectedAt.has(ws)) connectedAt.set(ws, Date.now());
  lastSeenAt.set(ws, Date.now());
}

export function getBoundWsUser(ws: ServerWebSocket<unknown>): UserRecord | null {
  return wsUsers.get(ws) ?? null;
}

export function setWsSessionPrefix(ws: ServerWebSocket<unknown>, prefix: string): void {
  if (prefix) sessionPrefixes.set(ws, prefix);
}

export function clearWsUser(ws: ServerWebSocket<unknown>): void {
  wsUsers.delete(ws);
  activeSockets.delete(ws);
  sessionPrefixes.delete(ws);
  connectedAt.delete(ws);
  lastSeenAt.delete(ws);
}

export function getSessionContext(ws: ServerWebSocket<unknown>): SessionContext | null {
  const user = getBoundWsUser(ws);
  if (!user) return null;
  return {
    userId: user.id,
    username: user.name,
    role: user.role,
    currentSessionPrefix: sessionPrefixes.get(ws) ?? "",
    connectionId: sessionPrefixes.get(ws) ?? "",
  };
}

export function listActiveSessions(): SessionWire[] {
  const now = Date.now();
  return [...activeSockets]
    .map((ws) => {
      const user = wsUsers.get(ws);
      const sessionPrefix = sessionPrefixes.get(ws);
      if (!user || !sessionPrefix) return null;
      return {
        sessionPrefix,
        userId: user.id,
        username: user.name,
        createdAt: connectedAt.get(ws) ?? now,
        lastSeenAt: lastSeenAt.get(ws) ?? now,
        expiresAt: now + 30 * 86400000,
        absoluteExpiresAt: now + 365 * 86400000,
      } satisfies SessionWire;
    })
    .filter((s): s is SessionWire => s !== null);
}
