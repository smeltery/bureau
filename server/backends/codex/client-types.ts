export type JsonRpcId = number | string;

export interface JsonRpcRequest {
  id: JsonRpcId;
  method: string;
  params?: unknown;
}

export interface JsonRpcNotification {
  method: string;
  params?: unknown;
}

export interface JsonRpcSuccessResponse {
  id: JsonRpcId;
  result: unknown;
}

export interface JsonRpcErrorResponse {
  id: JsonRpcId;
  error: { code: number; message: string; data?: unknown };
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

// Standard JSON-RPC error codes; we only emit the "method not found" /
// "internal error" ones when responding to unhandled server requests.
export const JSONRPC_METHOD_NOT_FOUND = -32601;
export const JSONRPC_INTERNAL_ERROR = -32603;

export type NotificationHandler = (notification: JsonRpcNotification) => void;

// Server-request handler. Return PASS to delegate to the next handler in
// registration order. Returning a value (or throwing) commits this handler to
// providing the response. If no handler claims a server request, the client
// auto-responds with method-not-found.
export const PASS: unique symbol = Symbol("PASS");
// Returning the PASS symbol (which is `unknown`-typed) declines the request
// and lets the next handler in registration order respond.
export type ServerRequestHandler = (request: JsonRpcRequest) => Promise<unknown>;
