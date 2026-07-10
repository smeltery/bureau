import type { JsonRpcId } from "./client-types.ts";

type Pending = {
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
};

export class JsonRpcPendingRequests {
  private nextRequestId = 1;
  private pending = new Map<JsonRpcId, Pending>();

  allocate<T>(): { id: JsonRpcId; promise: Promise<T> } {
    const id = this.nextRequestId++;
    const promise = new Promise<T>((resolve, reject) => {
      this.pending.set(id, {
        resolve: resolve as (v: unknown) => void,
        reject,
      });
    });
    return { id, promise };
  }

  delete(id: JsonRpcId): void {
    this.pending.delete(id);
  }

  settle(id: JsonRpcId, result: unknown, error?: { code?: number; message?: string; data?: unknown }): boolean {
    const pending = this.pending.get(id);
    if (!pending) return false;
    this.pending.delete(id);
    if (error) {
      pending.reject(Object.assign(new Error(`${error.message ?? "JSON-RPC error"} (code ${error.code ?? "?"})`), { code: error.code, data: error.data }));
    } else {
      pending.resolve(result);
    }
    return true;
  }

  failAll(reason: string | Error): void {
    const err = typeof reason === "string" ? new Error(reason) : reason;
    for (const [, pending] of this.pending) {
      try {
        pending.reject(err);
      } catch {}
    }
    this.pending.clear();
  }
}
