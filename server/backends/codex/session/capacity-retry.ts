import type { NormalizedEvent } from "../../types.ts";

export const CODEX_CAPACITY_RETRY_DELAYS_MS = [5_000, 15_000, 30_000] as const;

export class CodexCapacityRetry {
  errorThisAttempt: string | null = null;
  completedItemsThisAttempt = 0;
  retryCount = 0;
  private cancelRetry: (() => void) | null = null;

  constructor(
    private readonly scheduleRetry: (delayMs: number, run: () => void) => () => void,
    private readonly enqueue: (event: NormalizedEvent) => void,
  ) {}

  get hasPendingRetry(): boolean {
    return this.cancelRetry !== null;
  }

  resetAttempt(): void {
    this.errorThisAttempt = null;
    this.completedItemsThisAttempt = 0;
  }

  resetTurn(): void {
    this.cancelRetry?.();
    this.cancelRetry = null;
    this.errorThisAttempt = null;
    this.completedItemsThisAttempt = 0;
    this.retryCount = 0;
  }

  finishBackoff(status: "interrupted" | "failed", error: string): boolean {
    if (!this.cancelRetry) return false;
    this.resetTurn();
    this.enqueue({ kind: "turn_completed", status, error });
    return true;
  }

  retry(delayMs: number, run: () => void): void {
    const attempt = this.retryCount;
    this.retryCount += 1;
    this.enqueue({
      kind: "provider_capacity_retry",
      attempt,
      maxAttempts: CODEX_CAPACITY_RETRY_DELAYS_MS.length,
      delayMs,
    });
    this.cancelRetry = this.scheduleRetry(delayMs, () => {
      this.cancelRetry = null;
      this.resetAttempt();
      run();
    });
  }

  retryAsync(delayMs: number, run: () => Promise<void>, onResolve: () => void, onReject: (err: unknown) => void): void {
    this.retry(delayMs, () => {
      void run().then(onResolve).catch(onReject);
    });
  }
}
