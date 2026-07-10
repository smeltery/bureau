// JSON-RPC lite client for the Codex App Server.
//
// "JSON-RPC lite" (per the OpenAI Codex blog footnote): keeps the
// request/response/notification shape but omits the `"jsonrpc": "2.0"` header
// and is framed as JSONL over stdio. We write the framing ourselves; an
// off-the-shelf JSON-RPC library would reject these messages.
//
// Transport: spawn `codex app-server --listen stdio://`. stdin/stdout carry
// the JSON-RPC lite frames; stderr is opaque process output and routes to a
// caller-supplied handler (Bureau pipes it to the agent log).
//
// Wire shapes (post-handshake):
//   request:        { id, method, params }            — client → server
//   notification:   { method, params }                — either direction (no id)
//   response:       { id, result } or { id, error }   — either direction
//   server-request: { id, method, params }            — server → client; client
//                                                       must respond with same id
//
// Discrimination at parse time:
//   - has both `method` and `id`         → request (server-initiated)
//   - has `method` but no `id`           → notification
//   - has `id` and (`result` or `error`) → response to one of our requests
//
// The client is single-thread-aware: subscribers filter incoming notifications
// by threadId (filtering happens at subscription, not here). A future shared-
// subprocess deployment can swap this client out without callsite changes.
//
// Per-session deployment is the v1 default (symmetric with Claude, crash
// isolation, simpler auth/request-id scoping). The transport layer is
// designed to support sharing later without breaking the contract.

import type { ChildProcessWithoutNullStreams } from "child_process";
import {
  PASS,
  type JsonRpcErrorResponse,
  type JsonRpcId,
  type JsonRpcNotification,
  type JsonRpcRequest,
  type JsonRpcSuccessResponse,
  type NotificationHandler,
  type ServerRequestHandler,
} from "./client-types.ts";
import { spawnCodexAppServer, terminateCodexProcessGroup } from "./client-process.ts";
import { attachCodexChildEvents } from "./client-child-events.ts";
import { writeCodexFrame } from "./client-write.ts";
import { JsonlFrameBuffer } from "./client-jsonl-buffer.ts";
import { JsonRpcPendingRequests } from "./client-pending.ts";
import { dispatchCodexClientFrame } from "./client-dispatch.ts";
import { JsonRpcClientHandlers } from "./client-handlers.ts";
import type { InitializeParams } from "./_generated/InitializeParams.ts";
import type { InitializeResponse } from "./_generated/InitializeResponse.ts";

export type { JsonRpcId, JsonRpcNotification, JsonRpcRequest } from "./client-types.ts";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface JsonRpcLiteClientOptions {
  cwd?: string;
  env?: { [key: string]: string | undefined };
  // Override the spawn binary for tests. Defaults to spawning the bundled
  // @openai/codex launcher under process.execPath (Bun). Tests can point
  // this at any executable and bypass the launcher resolution entirely.
  codexBin?: string;
  // Override the args. Defaults to ["app-server", "--listen", "stdio://"]
  // (the launcher path is prepended automatically when codexBin is not set).
  args?: string[];
}

export { PASS };
export type { NotificationHandler, ServerRequestHandler };

// ---------------------------------------------------------------------------
// Client
// ---------------------------------------------------------------------------

export class JsonRpcLiteClient {
  private child: ChildProcessWithoutNullStreams | null = null;
  private pending = new JsonRpcPendingRequests();
  private stdoutBuffer = new JsonlFrameBuffer();
  private closed = false;
  // Guards the OS-process kill in close(), tracked separately from `closed`
  // which may be set by error/exit handlers while the child is still alive.
  private killed = false;
  private killTimer: ReturnType<typeof setTimeout> | null = null;
  private exitInfo: {
    code: number | null;
    signal: NodeJS.Signals | null;
  } | null = null;
  private initialized = false;
  private handlers = new JsonRpcClientHandlers();

  constructor(private readonly opts: JsonRpcLiteClientOptions = {}) {}

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  // Spawn the subprocess. Idempotent — calling start() twice throws.
  start(): void {
    if (this.child) {
      throw new Error("JsonRpcLiteClient.start() called twice");
    }
    if (this.closed) {
      throw new Error("JsonRpcLiteClient is closed");
    }
    this.child = spawnCodexAppServer(this.opts);
    attachCodexChildEvents({
      child: this.child,
      failAllPending: (reason) => this.pending.failAll(reason),
      onErrorClosed: () => {
        this.closed = true;
      },
      onStdout: (chunk) => this.onStdoutChunk(chunk),
      onStderr: (chunk) => this.handlers.emitStderr(chunk),
      clearKillTimer: () => {
        if (this.killTimer) {
          clearTimeout(this.killTimer);
          this.killTimer = null;
        }
      },
      onExit: (code, signal) => {
        this.exitInfo = { code, signal };
        this.closed = true;
        this.handlers.emitExit(code, signal);
      },
      onClose: () => this.handlers.emitClose(),
    });
  }

  // Send the JSON-RPC `initialize` handshake. Caller is responsible for
  // setting `experimentalApi: true` in params.capabilities if they want the
  // experimental surface (we generated schemas with --experimental, so most
  // callers will).
  async initialize(params: InitializeParams): Promise<InitializeResponse> {
    if (this.initialized) {
      throw new Error("initialize() called twice on the same client");
    }
    const response = await this.request<InitializeResponse>("initialize", params);
    this.initialized = true;
    // Per the protocol: client sends `initialized` notification after the
    // handshake response.
    this.notify("initialized", {});
    return response;
  }

  // Close the subprocess and resolve cleanup. Idempotent.
  async close(): Promise<void> {
    if (!this.killed) {
      this.killed = true;
      const child = this.child;
      if (child) {
        this.killTimer = terminateCodexProcessGroup(child);
      }
    }
    this.closed = true;
    this.pending.failAll("client closed");
  }

  // -------------------------------------------------------------------------
  // Outbound: requests and notifications
  // -------------------------------------------------------------------------

  // Send a JSON-RPC request, await response. Rejects on transport failure or
  // server error response.
  async request<T = unknown>(method: string, params?: unknown): Promise<T> {
    if (this.closed || !this.child) {
      throw new Error(`cannot send ${method}: client is closed`);
    }
    const { id, promise } = this.pending.allocate<T>();
    const frame: JsonRpcRequest = {
      id,
      method,
      ...(params !== undefined ? { params } : {}),
    };
    // Defensive: attach a noop catch so Bun does not flag the rejection as
    // unhandled in the window between Promise construction and the caller's
    // await. Observed crash mode: write() succeeds, then child.on('error')
    // fires async with ENOENT and failAllPending() rejects this promise; on
    // Bun the rejection has shown up as "unhandled" and crashed the process
    // even though bootstrap() / listModels() are awaiting it. The await chain
    // still receives the rejection normally — catching here only suppresses
    // the unhandled-rejection report, not the value seen by awaiters.
    promise.catch(() => {});
    try {
      this.write(frame);
    } catch (err) {
      // write() can throw if stdin is dead (subprocess never started, e.g.
      // posix_spawn ENOENT). Drop the pending so a later child.on('error')
      // doesn't reject an orphaned promise — that rejection has no awaiter
      // (request()'s own catch already surfaced the write error) and would
      // crash the process as an unhandled rejection.
      this.pending.delete(id);
      throw err;
    }
    return promise;
  }

  // Fire-and-forget notification. Synchronous on the wire; never throws (any
  // write error is silently dropped, matching JSON-RPC notification semantics).
  notify(method: string, params?: unknown): void {
    if (this.closed || !this.child) return;
    const frame: JsonRpcNotification = {
      method,
      ...(params !== undefined ? { params } : {}),
    };
    try {
      this.write(frame);
    } catch {}
  }

  // Send a response to a server-initiated request. Most callers won't use
  // this directly — handler return values from onServerRequest are auto-
  // packaged into responses. Provided for handlers that need to deferred-
  // respond after the handler returns.
  respond(id: JsonRpcId, result: unknown): void {
    if (this.closed || !this.child) return;
    const frame: JsonRpcSuccessResponse = { id, result };
    try {
      this.write(frame);
    } catch {}
  }

  respondWithError(id: JsonRpcId, code: number, message: string, data?: unknown): void {
    if (this.closed || !this.child) return;
    const frame: JsonRpcErrorResponse = {
      id,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    };
    try {
      this.write(frame);
    } catch {}
  }

  // -------------------------------------------------------------------------
  // Inbound: subscriptions
  // -------------------------------------------------------------------------

  // Subscribe to incoming notifications. Returns an unsubscribe function.
  // Subscribers receive every notification; filter by params.threadId (or
  // other discriminators) downstream.
  onNotification(handler: NotificationHandler): () => void {
    return this.handlers.onNotification(handler);
  }

  // Register a handler for server-initiated requests. Handlers are tried in
  // registration order; the first to return a non-PASS value (or throw)
  // commits to providing the response. If all handlers PASS, the client
  // responds method-not-found.
  onServerRequest(handler: ServerRequestHandler): () => void {
    return this.handlers.onServerRequest(handler);
  }

  onStderr(handler: (chunk: string) => void): () => void {
    return this.handlers.onStderr(handler);
  }

  onExit(handler: (code: number | null, signal: NodeJS.Signals | null) => void): () => void {
    return this.handlers.onExit(handler);
  }

  onClose(handler: () => void): () => void {
    return this.handlers.onClose(handler);
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private write(frame: unknown): void {
    writeCodexFrame(this.child, frame);
  }

  private onStdoutChunk(chunk: string): void {
    this.stdoutBuffer.push(chunk, (line) => this.dispatch(line));
  }

  private dispatch(line: string): void {
    dispatchCodexClientFrame(line, {
      pending: this.pending,
      notificationHandlers: this.handlers.notificationHandlers,
      serverRequestHandlers: this.handlers.serverRequestHandlers,
      stderrHandlers: this.handlers.stderrHandlers,
      respond: (id, result) => this.respond(id, result),
      respondWithError: (id, code, message, data) => this.respondWithError(id, code, message, data),
    });
  }

  // -------------------------------------------------------------------------
  // Inspection (mostly for tests / debugging)
  // -------------------------------------------------------------------------

  isClosed(): boolean {
    return this.closed;
  }
  isInitialized(): boolean {
    return this.initialized;
  }
  pid(): number | undefined {
    return this.child?.pid;
  }
  exitStatus(): { code: number | null; signal: NodeJS.Signals | null } | null {
    return this.exitInfo;
  }
}
