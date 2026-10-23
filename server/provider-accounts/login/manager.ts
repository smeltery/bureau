import { createHash } from "node:crypto";
import type { ProviderAccountProvider, ProviderSignInStatus } from "../../../shared/provider-accounts.ts";
import { AccountError, type AccountClient, type AccountScope, type AccountStatus, type AccountTarget } from "./types.ts";

type Operation = {
  id: string;
  target: AccountTarget;
  userId: string;
  holderName: string;
  startedAt: number;
  phase: ProviderSignInStatus["phase"];
  client?: AccountClient;
  verifier?: AccountClient;
  closing?: Promise<void>;
  url?: string;
  userCode?: string;
  cancelled: boolean;
  valid(): boolean;
  ready: Promise<void>;
  timer?: ReturnType<typeof setTimeout>;
  monitor?: ReturnType<typeof setInterval>;
};
export interface AccountManagerDeps {
  target(userId: string, provider: ProviderAccountProvider, scope: AccountScope, create?: boolean): AccountTarget;
  client(target: AccountTarget): AccountClient;
  activate(target: AccountTarget, active: boolean): void;
  changed(userId: string, provider: ProviderAccountProvider, scope: AccountScope): void;
  timeoutMs?: number;
}
export class ProviderLoginManager {
  private clients = new Set<AccountClient>();
  private active = new Map<string, Operation>();
  private probes = new Map<string, Promise<AccountStatus>>();
  private cache = new Map<string, { at: number; status: AccountStatus }>();
  private outcomes = new Map<string, { at: number; error?: string }>();
  constructor(private readonly deps: AccountManagerDeps) {}
  private fingerprint(target: AccountTarget) {
    return `${target.key}:${createHash("sha256")
      .update(JSON.stringify(Object.entries(target.env).sort()))
      .digest("hex")}`;
  }
  private outcomeKey(target: AccountTarget) {
    return `${target.userId}:${target.scope}:${target.key}`;
  }
  private stillCurrent(op: Operation) {
    if (op.cancelled || this.active.get(op.target.key) !== op || !op.valid()) return false;
    try {
      const target = this.deps.target(op.userId, op.target.provider, op.target.scope);
      return this.fingerprint(target) === this.fingerprint(op.target);
    } catch {
      return false;
    }
  }
  private requireCurrent(op: Operation) {
    if (!this.stillCurrent(op)) throw new AccountError("Sign-in cancelled or account settings changed.", 409);
  }
  private async bounded<T>(work: Promise<T>, milliseconds = 15_000): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        work,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new AccountError("Provider account request timed out. Try again.", 504)), milliseconds);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  private async readFresh(target: AccountTarget, op?: Operation): Promise<AccountStatus> {
    const client = this.deps.client(target);
    this.clients.add(client);
    if (op) op.verifier = client;
    try {
      return await this.bounded(
        (async () => {
          await client.start();
          return client.read();
        })(),
      );
    } finally {
      await client.close();
      this.clients.delete(client);
    }
  }
  private async probe(target: AccountTarget, refresh: boolean): Promise<AccountStatus> {
    if (!target.available) return { connected: false };
    const fingerprint = this.fingerprint(target);
    const cached = this.cache.get(fingerprint);
    if (!refresh && cached && Date.now() - cached.at < 15_000) return cached.status;
    const existing = this.probes.get(target.key);
    if (existing) {
      await existing;
      return this.probe(target, false);
    }
    const promise = this.readFresh(target);
    this.probes.set(target.key, promise);
    try {
      const status = await promise;
      if (this.cache.size >= 128) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(fingerprint, { at: Date.now(), status });
      return status;
    } catch (error) {
      this.cache.delete(fingerprint);
      throw error;
    } finally {
      if (this.probes.get(target.key) === promise) this.probes.delete(target.key);
    }
  }
  async status(userId: string, provider: ProviderAccountProvider, scope: AccountScope, refresh = false): Promise<ProviderSignInStatus> {
    const target = this.deps.target(userId, provider, scope);
    let operation = this.active.get(target.key);
    let status = this.cache.get(this.fingerprint(target))?.status ?? { connected: false };
    if (!operation) status = await this.probe(target, refresh);
    const currentTarget = this.deps.target(userId, provider, scope);
    if (currentTarget.key !== target.key || this.fingerprint(currentTarget) !== this.fingerprint(target)) throw new AccountError("Account settings changed. Refresh and try again.", 409);
    operation = this.active.get(target.key);
    const outcome = this.outcomes.get(this.outcomeKey(target));
    return {
      provider,
      scope,
      ...status,
      apiKeyPresent: target.apiKeyPresent,
      managed: target.managed,
      activePersonal: target.activePersonal,
      phase: operation?.phase ?? "idle",
      ...(operation
        ? {
            operationId: operation.id,
            holderName: operation.holderName,
            startedAt: operation.startedAt,
            ...(operation.userId === userId ? { authUrl: operation.url, userCode: operation.userCode } : {}),
          }
        : outcome && Date.now() - outcome.at < 300_000
          ? { error: outcome.error }
          : {}),
    };
  }
  async start(userId: string, holderName: string, provider: ProviderAccountProvider, scope: AccountScope, method: "browser" | "device", valid: () => boolean) {
    if (!valid()) throw new AccountError("Sign-in authorization expired.", 401);
    const target = this.deps.target(userId, provider, scope, true);
    const existing = this.active.get(target.key);
    if (existing) {
      if (existing.cancelled) throw new AccountError("The previous sign-in is still closing. Try again shortly.", 409);
      if (existing.userId !== userId) throw new AccountError(`Another member is signing in to this account. Wait or ask an owner to cancel it.`, 409);
      await existing.ready;
      return this.status(userId, provider, scope);
    }
    if (this.active.size >= 16) throw new AccountError("Too many sign-ins are running. Try again shortly.", 429);
    const op: Operation = { id: crypto.randomUUID(), target, userId, holderName, startedAt: Date.now(), phase: "starting", cancelled: false, valid, ready: Promise.resolve() };
    this.active.set(target.key, op);
    this.outcomes.delete(this.outcomeKey(target));
    op.timer = setTimeout(() => {
      void this.stop(op, "Sign-in expired. Start again.");
    }, this.deps.timeoutMs ?? 600_000);
    op.monitor = setInterval(() => {
      if (!this.stillCurrent(op)) void this.stop(op, "Sign-in cancelled because access or account settings changed.");
    }, 2000);
    op.timer.unref?.();
    op.monitor.unref?.();
    op.ready = this.begin(op, method);
    await op.ready;
    return this.status(userId, provider, scope);
  }
  private async begin(op: Operation, method: "browser" | "device") {
    try {
      await Promise.allSettled([this.probes.get(op.target.key)]);
      this.requireCurrent(op);
      const client = (op.client = this.deps.client(op.target));
      this.clients.add(client);
      const login = await this.bounded(
        (async () => {
          await client.start();
          this.requireCurrent(op);
          return client.login(method);
        })(),
        30_000,
      );
      this.requireCurrent(op);
      op.url = login.url;
      op.userCode = login.userCode;
      op.phase = "waiting";
      void this.finish(op);
    } catch (error) {
      await this.stop(op, error instanceof AccountError ? error.message : "Provider sign-in failed. Try again or use the terminal login command.");
      throw error instanceof AccountError ? error : new AccountError("Provider sign-in failed. Try again or use the terminal login command.", 502);
    }
  }
  private async close(op: Operation) {
    op.closing ??= op.client?.close() ?? Promise.resolve();
    await op.closing;
    if (op.client) this.clients.delete(op.client);
  }
  private release(op: Operation, error?: string) {
    clearTimeout(op.timer);
    clearInterval(op.monitor);
    if (this.active.get(op.target.key) !== op) return;
    this.active.delete(op.target.key);
    this.cache.clear();
    if (this.outcomes.size >= 128) this.outcomes.delete(this.outcomes.keys().next().value!);
    this.outcomes.set(this.outcomeKey(op.target), { at: Date.now(), error });
    this.deps.changed(op.userId, op.target.provider, op.target.scope);
  }
  private async stop(op: Operation, error?: string) {
    op.cancelled = true;
    op.phase = "cancelling";
    try {
      await this.close(op);
      await op.verifier?.close();
      this.release(op, error);
    } catch {
      op.client?.terminate?.();
      op.verifier?.terminate?.();
      console.warn("Provider account cleanup failed; its directory remains reserved until restart.");
    }
  }
  private async finish(op: Operation) {
    try {
      await op.client!.complete();
      this.requireCurrent(op);
      op.phase = "verifying";
      await this.close(op);
      this.requireCurrent(op);
      const status = await this.readFresh(op.target, op);
      this.requireCurrent(op);
      if (!status.connected) throw new AccountError("Sign-in finished, but the saved account could not be verified. Try again.", 502);
      this.deps.activate(op.target, true);
      this.release(op);
    } catch (error) {
      if (this.active.get(op.target.key) === op) await this.stop(op, error instanceof AccountError ? error.message : "Could not verify the saved provider account.");
    }
  }
  private operation(userId: string, provider: ProviderAccountProvider, scope: AccountScope, id: string, allowForeign: boolean) {
    const target = this.deps.target(userId, provider, scope);
    const op = this.active.get(target.key);
    if (!op || op.id !== id || (op.userId !== userId && !allowForeign)) throw new AccountError("This sign-in is no longer active.", 409);
    return op;
  }
  async callback(userId: string, provider: ProviderAccountProvider, scope: AccountScope, id: string, code: string) {
    const op = this.operation(userId, provider, scope, id, false);
    this.requireCurrent(op);
    if (op.phase !== "waiting" || !op.client?.callback) throw new AccountError("This sign-in does not accept a pasted code.", 409);
    await this.bounded(op.client.callback(code));
  }
  async cancel(userId: string, provider: ProviderAccountProvider, scope: AccountScope, id: string, allowForeign: boolean) {
    await this.stop(this.operation(userId, provider, scope, id, allowForeign));
  }
  async disconnect(userId: string, provider: ProviderAccountProvider, scope: AccountScope, valid: () => boolean) {
    if (!valid()) throw new AccountError("Sign-in authorization expired.", 401);
    const target = this.deps.target(userId, provider, scope);
    if (this.active.has(target.key)) throw new AccountError("Cancel the active sign-in before disconnecting.", 409);
    const op: Operation = { id: crypto.randomUUID(), target, userId, holderName: "", startedAt: Date.now(), phase: "verifying", cancelled: false, valid, ready: Promise.resolve() };
    this.active.set(target.key, op);
    try {
      await Promise.allSettled([this.probes.get(target.key)]);
      this.requireCurrent(op);
      const client = (op.client = this.deps.client(target));
      this.clients.add(client);
      await this.bounded(
        (async () => {
          await client.start();
          this.requireCurrent(op);
          await client.logout();
        })(),
      );
      await this.close(op);
      this.requireCurrent(op);
      if ((await this.readFresh(target, op)).connected) throw new AccountError("The provider still reports a connected account. Use its terminal logout command.", 502);
      this.requireCurrent(op);
      this.deps.activate(target, false);
      this.release(op);
    } catch (error) {
      await this.stop(op);
      throw error;
    }
  }
  terminate() {
    for (const client of this.clients) client.terminate?.();
  }
  async shutdown() {
    await Promise.allSettled([...this.active.values()].map((op) => this.stop(op)));
  }
}
