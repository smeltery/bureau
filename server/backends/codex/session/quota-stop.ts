import type { NormalizedEvent } from "../../types.ts";
import type { RateLimitSnapshot } from "../_generated/v2/RateLimitSnapshot.ts";
import { codexResetsAtMs } from "../session-rate-limits.ts";

type Completed = Extract<NormalizedEvent, { kind: "turn_completed" }>;
type Schedule = (run: () => void, ms: number) => () => void;

export function quotaResetAt(snapshot: RateLimitSnapshot | null): number | undefined {
  if (!snapshot || snapshot.spendControlReached || (snapshot.rateLimitReachedType !== null && snapshot.rateLimitReachedType !== "rate_limit_reached")) return undefined;
  const windows = [snapshot.primary, snapshot.secondary].filter((window) => window !== null);
  const exhausted = windows.filter((window) => window.usedPercent >= 100);
  if (!exhausted.length && snapshot.rateLimitReachedType !== "rate_limit_reached") return undefined;
  const highest = Math.max(...windows.map((window) => window.usedPercent));
  const blocking = exhausted.length ? exhausted : windows.filter((window) => window.usedPercent === highest);
  const resets = blocking.map((window) => codexResetsAtMs(window.resetsAt));
  if (!resets.length || resets.some((reset) => reset === null || !Number.isSafeInteger(reset))) return undefined;
  return Math.max(...(resets as number[]));
}

export class CodexQuotaStop {
  private refused = false;
  private pending: { event: Completed; cancel: () => void } | null = null;

  constructor(
    private readonly resetAt: () => number | undefined,
    private readonly refresh: () => Promise<void>,
    private readonly enqueue: (event: NormalizedEvent) => void,
    private readonly schedule: Schedule = (run, ms) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    },
  ) {}

  get waiting(): boolean {
    return this.pending !== null;
  }

  note(errorInfo: unknown): void {
    if (errorInfo === "usageLimitExceeded") this.refused = true;
  }

  cancel(): void {
    this.refused = false;
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    pending.cancel();
    this.enqueue({ ...pending.event, status: "interrupted" });
  }

  complete(event: Completed, errorInfo: unknown): void {
    const limited = this.refused || errorInfo === "usageLimitExceeded";
    this.refused = false;
    if (!limited || event.status !== "failed" || event.causedByAuth || event.causedByProviderCapacity) {
      this.enqueue(event);
      return;
    }
    const known = this.resetAt();
    if (known !== undefined && known > Date.now()) {
      this.enqueue({ ...event, usageLimitResetAt: known });
      return;
    }
    const pending = { event, cancel: () => {} };
    this.pending = pending;
    const finish = () => {
      if (this.pending !== pending) return;
      this.pending = null;
      pending.cancel();
      const reset = this.resetAt();
      this.enqueue(reset !== undefined && reset > Date.now() ? { ...event, usageLimitResetAt: reset } : event);
    };
    pending.cancel = this.schedule(finish, 2000);
    void this.refresh().then(finish, finish);
  }
}
