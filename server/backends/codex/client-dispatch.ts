import { errMessage } from "../../../shared/errors.ts";
import {
  JSONRPC_INTERNAL_ERROR,
  JSONRPC_METHOD_NOT_FOUND,
  PASS,
  type JsonRpcId,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type NotificationHandler,
  type ServerRequestHandler,
} from "./client-types.ts";
import type { JsonRpcPendingRequests } from "./client-pending.ts";

export interface CodexClientDispatchDeps {
  pending: JsonRpcPendingRequests;
  notificationHandlers: Set<NotificationHandler>;
  serverRequestHandlers: ServerRequestHandler[];
  stderrHandlers: Set<(chunk: string) => void>;
  respond: (id: JsonRpcId, result: unknown) => void;
  respondWithError: (id: JsonRpcId, code: number, message: string, data?: unknown) => void;
}

export function dispatchCodexClientFrame(line: string, deps: CodexClientDispatchDeps): void {
  let frame: unknown;
  try {
    frame = JSON.parse(line);
  } catch (err) {
    emitStderr(deps.stderrHandlers, `[codex client] JSON parse error: ${errMessage(err)}\nframe: ${line.slice(0, 200)}\n`);
    return;
  }
  if (frame == null || typeof frame !== "object") return;
  const f = frame as {
    id?: JsonRpcId;
    method?: string;
    result?: unknown;
    error?: { code?: number; message?: string; data?: unknown };
  };

  const hasId = "id" in f && f.id != null;
  const hasMethod = "method" in f && typeof f.method === "string";

  if (hasMethod && hasId) {
    void handleServerRequest(f as JsonRpcRequest, deps);
    return;
  }
  if (hasMethod) {
    dispatchNotification(f as JsonRpcNotification, deps);
    return;
  }
  if (hasId) {
    settleResponse(f, deps);
    return;
  }
  emitStderr(deps.stderrHandlers, `[codex client] unrecognized frame: ${line.slice(0, 200)}\n`);
}

function dispatchNotification(notification: JsonRpcNotification, deps: CodexClientDispatchDeps): void {
  for (const handler of deps.notificationHandlers) {
    try {
      handler(notification);
    } catch (err) {
      emitStderr(deps.stderrHandlers, `[codex client] notification handler error: ${errMessage(err)}\n`);
    }
  }
}

function settleResponse(
  frame: {
    id?: JsonRpcId;
    result?: unknown;
    error?: { code?: number; message?: string; data?: unknown };
  },
  deps: CodexClientDispatchDeps,
): void {
  const id = frame.id as JsonRpcId;
  const result = "result" in frame ? frame.result : undefined;
  if (!deps.pending.settle(id, result, frame.error)) {
    emitStderr(deps.stderrHandlers, `[codex client] response for unknown request id ${String(id)}\n`);
  }
}

async function handleServerRequest(request: JsonRpcRequest, deps: CodexClientDispatchDeps): Promise<void> {
  for (const handler of [...deps.serverRequestHandlers]) {
    try {
      const result = await handler(request);
      if (result === PASS) continue;
      deps.respond(request.id, result);
      return;
    } catch (err) {
      deps.respondWithError(request.id, JSONRPC_INTERNAL_ERROR, errMessage(err, "handler threw"));
      return;
    }
  }
  deps.respondWithError(request.id, JSONRPC_METHOD_NOT_FOUND, `No client handler for method "${request.method}"`);
}

function emitStderr(stderrHandlers: Set<(chunk: string) => void>, chunk: string): void {
  for (const handler of stderrHandlers) {
    try {
      handler(chunk);
    } catch {}
  }
}
