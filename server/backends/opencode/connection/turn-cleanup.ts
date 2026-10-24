import type { OpenCodeLease } from "../supervisor.ts";
import { openCodeRequest } from "./request.ts";

export class OpenCodeTurnCleanup {
  submitted = false;
  ended = false;
  private stopping = false;
  private pending = new Set<string>();
  private rejected = new Set<string>();
  private completion: Promise<void> | null = null;
  private stopCompletion: Promise<void> | null = null;

  constructor(
    private readonly request: ReturnType<typeof openCodeRequest>,
    private readonly sessionId: string,
    private readonly timeoutMs: number,
    private readonly failed: () => void,
  ) {}

  hasPending(id: string): boolean {
    return !this.ended && !this.stopping && this.pending.has(id);
  }

  track(id: string): void {
    if (this.ended || this.stopping) void this.rejectLate(id);
    else this.pending.add(id);
  }

  async reply(id: string, reply: "once" | "reject", message?: string): Promise<void> {
    this.pending.delete(id);
    await this.request(`/permission/${encodeURIComponent(id)}/reply`, {
      method: "POST",
      body: JSON.stringify({ reply: this.ended || this.stopping ? "reject" : reply, ...(message ? { message } : {}) }),
    });
  }

  async rejectLate(id: string): Promise<void> {
    if (this.rejected.has(id)) return;
    this.rejected.add(id);
    this.pending.delete(id);
    try {
      await this.reply(id, "reject");
    } catch {
      this.failed();
    }
  }

  stop(): Promise<void> {
    this.stopping = true;
    return (this.stopCompletion ??= this.clean(true));
  }

  finish(stop: boolean): Promise<void> {
    this.ended = true;
    return (this.completion ??= this.stopCompletion ?? this.clean(stop));
  }

  private async clean(stop: boolean): Promise<void> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const ids = [...this.pending];
      this.pending.clear();
      await Promise.all(
        ids.map(async (id) => {
          this.rejected.add(id);
          try {
            await this.request(`/permission/${encodeURIComponent(id)}/reply`, { method: "POST", signal: controller.signal, body: JSON.stringify({ reply: "reject" }) });
          } catch {
            this.failed();
          }
        }),
      );
      // A permission endpoint timeout must not prevent the session stop attempt.
      if (stop && this.submitted) await this.request(`/session/${encodeURIComponent(this.sessionId)}/abort`, { method: "POST" });
    } catch {
      this.failed();
    } finally {
      clearTimeout(timer);
    }
  }
}

export function createTurnCleanup(lease: OpenCodeLease, cwd: string, sessionId: string, timeoutMs: number): OpenCodeTurnCleanup {
  const pid = lease.pid;
  return new OpenCodeTurnCleanup(openCodeRequest(lease, cwd, timeoutMs), sessionId, timeoutMs, () => {
    try {
      if (lease.pid === pid) lease.markUnresponsive?.();
    } catch {
      /* A replaced lease cannot invalidate the new process. */
    }
  });
}
