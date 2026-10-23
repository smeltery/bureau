import { expect, test } from "bun:test";
import { ProviderLoginManager } from "./manager.ts";
import type { AccountClient, AccountStatus, AccountTarget } from "./types.ts";
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  void promise.catch(() => {});
  return { promise, resolve, reject };
}
function fixture(timeoutMs = 60_000) {
  let connected = false;
  let directory = "directory";
  const clients: AccountClient[] = [];
  const completions: ReturnType<typeof deferred<void>>[] = [];
  const activations: boolean[] = [];
  const closed: number[] = [];
  let customize = (_client: AccountClient, _index: number) => {};
  const manager = new ProviderLoginManager({
    timeoutMs,
    target: (userId, provider, scope) => ({
      userId,
      provider,
      scope,
      directory,
      key: scope === "office" ? directory : `${userId}:${directory}`,
      env: {},
      managed: scope === "personal",
      available: true,
      apiKeyPresent: false,
    }),
    client: (_target: AccountTarget) => {
      const index = clients.length;
      const completion = deferred<void>();
      completions.push(completion);
      const client: AccountClient = {
        start: async () => {},
        read: async () => ({ connected }),
        login: async () => ({ url: "https://claude.ai/login", userCode: "PRIVATE-CODE" }),
        complete: () => completion.promise,
        callback: async () => {},
        logout: async () => {
          connected = false;
        },
        close: async () => {
          closed.push(index);
          completion.reject(new Error("closed"));
        },
      };
      customize(client, index);
      clients.push(client);
      return client;
    },
    activate: (_target, active) => activations.push(active),
    changed: () => {},
  });
  return {
    manager,
    clients,
    completions,
    activations,
    closed,
    connected: (value: boolean) => {
      connected = value;
    },
    directory: (value: string) => {
      directory = value;
    },
    customize: (fn: typeof customize) => {
      customize = fn;
    },
  };
}
const tick = () => Bun.sleep(0);
test("login reserves a directory before awaits, deduplicates starts and hides ceremony details from other members", async () => {
  const f = fixture();
  try {
    const first = f.manager.start("one", "One", "claude", "office", "browser", () => true);
    await expect(f.manager.start("two", "Two", "claude", "office", "browser", () => true)).rejects.toThrow("Another member");
    const repeat = f.manager.start("one", "One", "claude", "office", "browser", () => true);
    const [a, b] = await Promise.all([first, repeat]);
    expect(a.operationId).toBe(b.operationId);
    expect(f.clients).toHaveLength(1);
    const foreign = await f.manager.status("two", "claude", "office");
    expect(foreign.holderName).toBe("One");
    expect(foreign.authUrl).toBeUndefined();
    expect(foreign.userCode).toBeUndefined();
    await expect(f.manager.callback("two", "claude", "office", a.operationId!, "code")).rejects.toThrow("no longer active");
    await expect(f.manager.cancel("two", "claude", "office", a.operationId!, false)).rejects.toThrow();
    await f.manager.cancel("two", "claude", "office", a.operationId!, true);
  } finally {
    await f.manager.shutdown();
  }
});
test("a fresh client verifies saved credentials before personal activation", async () => {
  const f = fixture();
  try {
    await f.manager.start("one", "One", "codex", "personal", "device", () => true);
    expect(f.activations).toEqual([]);
    f.connected(true);
    f.completions[0].resolve();
    await tick();
    expect(f.clients).toHaveLength(2);
    expect(f.closed).toContain(0);
    expect(f.closed).toContain(1);
    expect(f.activations).toEqual([true]);
  } finally {
    await f.manager.shutdown();
  }
});
test("unsaved credentials, cancelled operations, and changed directories cannot activate", async () => {
  for (const mode of ["unverified", "cancelled", "changed"]) {
    const f = fixture();
    try {
      const status = await f.manager.start("one", "One", "claude", "personal", "browser", () => true);
      if (mode === "cancelled") await f.manager.cancel("one", "claude", "personal", status.operationId!, false);
      if (mode === "changed") f.directory("replacement");
      f.completions[0].resolve();
      await tick();
      expect(f.activations).toEqual([]);
    } finally {
      await f.manager.shutdown();
    }
  }
});
test("pending probes finish before login and failures do not poison the status cache", async () => {
  const f = fixture();
  const probe = deferred<AccountStatus>();
  f.customize((client, index) => {
    if (index === 0) client.read = () => probe.promise;
  });
  try {
    const reading = f.manager.status("one", "codex", "office");
    await tick();
    const login = f.manager.start("one", "One", "codex", "office", "device", () => true);
    await tick();
    expect(f.clients).toHaveLength(1);
    probe.resolve({ connected: false });
    await reading;
    await login;
    expect(f.clients).toHaveLength(2);
  } finally {
    await f.manager.shutdown();
  }
  const failed = fixture();
  failed.customize((client, index) => {
    if (index === 0)
      client.read = async () => {
        throw new Error("failed");
      };
  });
  await expect(failed.manager.status("one", "claude", "office")).rejects.toThrow("failed");
  expect((await failed.manager.status("one", "claude", "office")).connected).toBe(false);
  expect(failed.clients).toHaveLength(2);
});
test("cancellation holds the directory until its process closes and stale operation IDs cannot cancel a new login", async () => {
  const f = fixture();
  const closing = deferred<void>();
  f.customize((client, index) => {
    if (index === 0) {
      const close = client.close;
      client.close = async () => {
        await closing.promise;
        await close();
      };
    }
  });
  const first = await f.manager.start("one", "One", "codex", "office", "device", () => true);
  const cancelled = f.manager.cancel("one", "codex", "office", first.operationId!, false);
  await tick();
  await expect(f.manager.start("two", "Two", "codex", "office", "device", () => true)).rejects.toThrow();
  closing.resolve();
  await cancelled;
  const next = await f.manager.start("one", "One", "codex", "office", "device", () => true);
  expect(next.operationId).not.toBe(first.operationId);
  await expect(f.manager.cancel("one", "codex", "office", first.operationId!, false)).rejects.toThrow();
  await f.manager.shutdown();
});
test("login deadlines release processes and failed disconnect verification preserves activation", async () => {
  const f = fixture(20);
  await f.manager.start("one", "One", "codex", "personal", "device", () => true);
  await Bun.sleep(40);
  expect((await f.manager.status("one", "codex", "personal")).error).toContain("expired");
  expect(f.closed).toContain(0);
  const logout = fixture();
  logout.connected(true);
  logout.customize((client) => {
    client.logout = async () => {};
  });
  await expect(logout.manager.disconnect("one", "claude", "personal", () => true)).rejects.toThrow("still reports");
  expect(logout.activations).toEqual([]);
});
test("failed refresh evicts a previously connected account and exit terminates probes", async () => {
  const f = fixture();
  f.connected(true);
  expect((await f.manager.status("one", "codex", "office")).connected).toBe(true);
  let terminated = false;
  f.customize((client, index) => {
    client.terminate = () => {
      terminated = true;
    };
    if (index === 1)
      client.read = async () => {
        f.manager.terminate();
        throw new Error("refresh failed");
      };
  });
  await expect(f.manager.status("one", "codex", "office", true)).rejects.toThrow("refresh failed");
  expect(terminated).toBe(true);
  f.connected(false);
  expect((await f.manager.status("one", "codex", "office")).connected).toBe(false);
  expect(f.clients).toHaveLength(3);
});
