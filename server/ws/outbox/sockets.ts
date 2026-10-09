import type { ServerWebSocket } from "bun";
import { BrowserOutbox } from "./queue.ts";

const officeSockets = new WeakMap<object, ServerWebSocket<unknown>>();
const outboxes = new WeakMap<object, BrowserOutbox>();
const initialized = new WeakSet<object>();

/** Keep one socket identity throughout office auth, watchers, and broadcasts.
 * Only send is queued; Bun methods and accessors retain their native receiver.
 * App relay sockets never pass through this adapter. */
export function officeSocket<T>(raw: ServerWebSocket<T>): ServerWebSocket<T> {
  const existing = officeSockets.get(raw);
  if (existing) return existing as ServerWebSocket<T>;
  const queue = new BrowserOutbox(raw);
  const send = (data: string) => queue.send(data);
  const socket = new Proxy(raw, {
    get(target, key) {
      if (key === "send") return send;
      const value = Reflect.get(target, key, target);
      return typeof value === "function" ? value.bind(target) : value;
    },
    set(target, key, value) {
      return Reflect.set(target, key, value, target);
    },
  });
  officeSockets.set(raw, socket);
  outboxes.set(socket, queue);
  return socket;
}

export function replayOfficeFrames(socket: ServerWebSocket<unknown>, frames: Iterator<string>): void {
  const queue = outboxes.get(socket);
  if (!queue) {
    // Unwrapped test sockets retain the synchronous handler contract.
    for (let next = frames.next(); !next.done; next = frames.next()) socket.send(next.value);
    return;
  }
  // A changed room/user projection invalidates frames already authorized under
  // the previous view. Reconnect instead of draining that stale backlog.
  if (initialized.has(socket) && queue.backlogged) {
    frames.return?.();
    queue.fail();
    return;
  }
  initialized.add(socket);
  queue.replay(frames);
}

export function drainOfficeSocket(raw: ServerWebSocket<unknown>): void {
  const socket = officeSockets.get(raw);
  if (socket) outboxes.get(socket)?.drain();
}

export function disposeOfficeSocket(raw: ServerWebSocket<unknown>): void {
  const socket = officeSockets.get(raw);
  if (!socket) return;
  outboxes.get(socket)?.dispose();
  outboxes.delete(socket);
  officeSockets.delete(raw);
}
