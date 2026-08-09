// The relay's two neighbours, faked: the browser leg the office would supply,
// and the app-host world (a registry, a supervisor, an app session) the relay
// asks whether this socket may exist.
//
// Nothing here asserts anything, and nothing here is production-reachable: the
// supervisor and the registry arrive through the relay's own injected context,
// and the office session behind an app session goes through the store's
// test-only resolver seam.

import type { ServerWebSocket } from "bun";
import type { AppRecord } from "../../../shared/apps.ts";
import { APP_COOKIE_NAME } from "../host/auth-cookie.ts";
import { startAppSession, _testResetAppAuth, _testSetOfficeSessionResolver } from "../host/auth-store.ts";
import { relayWsToApp, type AppRelayWsData, type AppWsRelayContext } from "../host/ws-relay.ts";
import type { AppWsRelay } from "../host/ws-relay-socket.ts";
import type { AppRegistry } from "../registry.ts";
import { UNKNOWN_RUNTIME, type AppRuntime, type AppSupervisor } from "../supervisor.ts";

// A stand-in for Bun's server socket, which is what the office would supply.
// Records everything the relay does to it, and lets a test dictate the two
// answers that drive the backpressure policy: what send() returns and what
// getBufferedAmount() reports.
export interface FakeWs {
  ws: ServerWebSocket<AppRelayWsData>;
  sent: Array<string | Buffer>;
  closes: Array<{ code: number; reason: string }>;
  terminated: number;
  sendReturns: number | null;
  buffered: number;
}

export function fakeWs(): FakeWs {
  const state: FakeWs = { sent: [], closes: [], terminated: 0, sendReturns: null, buffered: 0, ws: null as unknown as ServerWebSocket<AppRelayWsData> };
  state.ws = {
    send(data: string | Buffer) {
      state.sent.push(data);
      if (state.sendReturns !== null) return state.sendReturns;
      return typeof data === "string" ? Buffer.byteLength(data) : data.length;
    },
    getBufferedAmount() {
      return state.buffered;
    },
    close(code: number, reason: string) {
      state.closes.push({ code, reason });
    },
    terminate() {
      state.terminated++;
    },
  } as unknown as ServerWebSocket<AppRelayWsData>;
  return state;
}

export const APP_HOST_DOMAIN = "office.example";
export const OFFICE_SESSION_HASH = "a".repeat(64);

export function appRecord(over: Partial<AppRecord> = {}): AppRecord {
  return {
    name: "hello",
    hostLabel: "hello",
    hostGen: 1,
    port: 21000,
    command: "bun run serve.ts",
    cwd: "/srv/hello",
    dataDir: "/state/apps/data/hello",
    userId: "u-alice",
    username: "alice",
    createdBy: "AppBot",
    createdAt: 1,
    ...over,
  };
}

export function appHostOf(app: AppRecord): string {
  return `${app.hostLabel}.${APP_HOST_DOMAIN}`;
}

// Only `list()` is ever reached from the relay; anything else would be a bug the
// cast makes loud rather than silent.
export function registryOf(...apps: AppRecord[]): AppRegistry {
  return { list: () => apps } as unknown as AppRegistry;
}

export function unreadableRegistry(): AppRegistry {
  return {
    list: () => {
      throw new Error("apps.json is unreadable");
    },
  } as unknown as AppRegistry;
}

// A supervisor that reports whatever the test says, without a machine. `states`
// is the only method the relay reaches.
export function supervisorSaying(states: Record<string, AppRuntime | undefined>): AppSupervisor {
  return {
    states: (names: readonly string[]) => {
      const out = new Map<string, AppRuntime>();
      for (const name of names) out.set(name, states[name] ?? UNKNOWN_RUNTIME);
      return out;
    },
  } as unknown as AppSupervisor;
}

export const RUNNING: AppRuntime = { state: "running", restartCount: 0 };

// A live app session, with the office session behind it standing in for the real
// store. Returns the raw cookie value the relay would read off the request.
export function signIn(app: AppRecord, opts: { role?: "owner" | "member"; userId?: string } = {}): string {
  _testSetOfficeSessionResolver(() => ({ userId: opts.userId ?? app.userId ?? "u-alice", role: opts.role ?? "member", absoluteExpiresAt: Date.now() + 3_600_000 }));
  const started = startAppSession({ label: app.hostLabel, hostGen: app.hostGen, officeSessionHash: OFFICE_SESSION_HASH, absoluteExpiresAt: Date.now() + 3_600_000 });
  if (started === null) throw new Error("could not start an app session");
  return started.token;
}

// The office session behind every app session in this test file is gone.
export function signOut(): void {
  _testSetOfficeSessionResolver(() => null);
}

// Teardown for the app-auth store: the tables AND the office-session seam. The
// seam is process-global, so leaving a stand-in installed would answer another
// test file's questions about the real store.
export function resetAppSessions(): void {
  _testResetAppAuth();
  _testSetOfficeSessionResolver(null);
}

// --- opening one relayed socket ----------------------------------------------

// The upgrade request a browser would send, with the app cookie on it.
export function upgradeRequest(app: AppRecord, cookie: string, opts: { path?: string; origin?: string; protocols?: string; headers?: Record<string, string> } = {}): Request {
  const host = appHostOf(app);
  const headers: Record<string, string> = {
    Host: host,
    Upgrade: "websocket",
    Connection: "Upgrade",
    Cookie: `${APP_COOKIE_NAME}=${cookie}`,
    ...(opts.origin ? { Origin: opts.origin } : {}),
    ...(opts.protocols !== undefined ? { "Sec-WebSocket-Protocol": opts.protocols } : {}),
    ...opts.headers,
  };
  return new Request(`http://${host}${opts.path ?? "/socket"}`, { headers });
}

// Everything relayWsToApp needs that a test does not usually care about: a
// running supervisor, a registry that lists this app, and an upgrade thunk that
// says yes and hands the relay back — the ONE seam these tests reach through, so
// they can play the part Bun would play.
export type RelaySeams = Partial<Omit<AppWsRelayContext, "app" | "host" | "apps">>;

export interface Opened {
  relay: AppWsRelay;
  browser: FakeWs;
}

export async function openRelay(
  app: AppRecord,
  cookie: string,
  seams: RelaySeams = {},
  requestOpts: Parameters<typeof upgradeRequest>[2] = {},
): Promise<{ ok: true; opened: Opened } | { ok: false; response: Response }> {
  const captured = await relayFor(app, cookie, seams, requestOpts);
  if (!captured.ok) return captured;
  const browser = fakeWs();
  captured.relay.attachBrowser(browser.ws);
  return { ok: true, opened: { relay: captured.relay, browser } };
}

// The same call without attaching a browser leg: for the tests about the window
// between the 101 and the runtime's `open`.
export async function relayFor(
  app: AppRecord,
  cookie: string,
  seams: RelaySeams = {},
  requestOpts: Parameters<typeof upgradeRequest>[2] = {},
): Promise<{ ok: true; relay: AppWsRelay } | { ok: false; response: Response }> {
  let captured: AppWsRelay | null = null;
  // The relay is captured whatever the caller's own upgrade thunk does with it —
  // including attaching a browser leg synchronously, or throwing — because the
  // tests about that window still need the object afterwards.
  const { upgrade, ...rest } = seams;
  const response = await relayWsToApp(upgradeRequest(app, cookie, requestOpts), {
    app,
    host: appHostOf(app),
    apps: [app],
    supervisor: supervisorSaying({ [app.name]: RUNNING }),
    registry: registryOf(app),
    ...rest,
    upgrade: (req, data, headers) => {
      captured = data.relay;
      return upgrade === undefined ? true : upgrade(req, data, headers);
    },
  });
  if (response !== undefined) return { ok: false, response };
  if (captured === null) throw new Error("upgrade was never called");
  return { ok: true, relay: captured };
}
