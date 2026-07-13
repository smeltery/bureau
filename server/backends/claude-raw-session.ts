import { query, type Options, type Query, type SDKMessage, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";

import { CLAUDE_NATIVE_BIN } from "../agents/session/claude-native.ts";

// Push-able async iterable of user turns. In 0.3.x the SDK consumes a
// streaming-input prompt (AsyncIterable<SDKUserMessage>) for the session's
// lifetime; each pushed message drives one assistant turn. Closing the queue
// completes the prompt iterable, which lets query() finish and unblocks the
// parked stream() consumer.
const QUEUE_DONE = Symbol("queue-done");

class InputQueue implements AsyncIterable<SDKUserMessage> {
  private pending: SDKUserMessage[] = [];
  private waiter: ((v: SDKUserMessage | typeof QUEUE_DONE) => void) | null = null;
  private closed = false;

  push(msg: SDKUserMessage): void {
    if (this.closed) return;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(msg);
    } else {
      this.pending.push(msg);
    }
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    if (this.waiter) {
      const w = this.waiter;
      this.waiter = null;
      w(QUEUE_DONE);
    }
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    while (true) {
      if (this.pending.length > 0) {
        yield this.pending.shift()!;
        continue;
      }
      if (this.closed) return;
      const next = await new Promise<SDKUserMessage | typeof QUEUE_DONE>((resolve) => {
        this.waiter = resolve;
      });
      if (next === QUEUE_DONE) return;
      yield next;
    }
  }
}

// Low-level wrapper over query() that restores the 0.2.x interactive-session
// shape (stream / send / close) on top of 0.3.x's streaming-input model.
export class RawClaudeSession {
  private readonly input = new InputQueue();
  readonly query: Query;
  private closed = false;

  constructor(options: Options) {
    this.query = query({ prompt: this.input, options });
  }

  // The query generator yields every SDKMessage across all turns until close.
  stream(): AsyncIterable<SDKMessage> {
    return this.query;
  }

  async send(msg: string | SDKUserMessage): Promise<void> {
    this.input.push(typeof msg === "string" ? ({ type: "user", message: { role: "user", content: msg }, parent_tool_use_id: null } as SDKUserMessage) : msg);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    // End the input stream and interrupt any in-flight turn. interrupt()
    // rejects if the query already finished, so swallow: close() is idempotent.
    this.input.close();
    void this.query.interrupt().catch(() => {});
  }
}

// Run a single stateless prompt to completion and return the terminal result.
export async function runClaudeOneShot(prompt: string, options: Options): Promise<{ subtype: "success" | "error"; result: string }> {
  const q = query({
    prompt,
    options: { pathToClaudeCodeExecutable: CLAUDE_NATIVE_BIN, ...options },
  });
  let out: { subtype: "success" | "error"; result: string } = { subtype: "error", result: "" };
  for await (const msg of q) {
    if (msg.type === "result") {
      out = msg.subtype === "success" ? { subtype: "success", result: msg.result } : { subtype: "error", result: "" };
    }
  }
  return out;
}
