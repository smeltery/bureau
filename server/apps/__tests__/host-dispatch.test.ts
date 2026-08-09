import { describe, expect, test } from "bun:test";
import { handleAppHostRequest, type AppHostDeps } from "../host/dispatch.ts";
import { APP_AUTH_PATH, APP_RESERVED_PATH } from "../host/auth-cookie.ts";
import type { AppRecord } from "../../../shared/apps.ts";
import type { AppRegistry } from "../registry.ts";
import type { AppSupervisor } from "../supervisor.ts";

// The dispatcher only. Its whole job is the divert-or-fall-through decision, so
// what these tests pin is the CONTAINMENT property: an office request must come
// back as null (untouched), and a diverted one must never reach an office
// handler. The relays and the auth gate have their own tests; here they are
// reached or not reached.

const DOMAIN = "office.example";

function record(over: Partial<AppRecord> = {}): AppRecord {
  return {
    name: "hello",
    hostLabel: "hello",
    hostGen: 1,
    port: 21001,
    command: "bun run start",
    cwd: "/tmp",
    dataDir: "/tmp/data",
    userId: "user-1",
    username: "Ada",
    createdBy: "Scout",
    createdAt: 1,
    ...over,
  };
}

// A supervisor that throws on every method: reaching it at all is the failure a
// test wants to hear about, and the relays are what would reach it.
function forbiddenSupervisor(): AppSupervisor {
  return new Proxy({} as AppSupervisor, {
    get(_t, prop) {
      return () => {
        throw new Error(`supervisor.${String(prop)}() must not be reached`);
      };
    },
  });
}

function deps(apps: AppRecord[], over: Partial<AppHostDeps> = {}): AppHostDeps {
  return {
    domain: DOMAIN,
    registry: { list: () => apps } as unknown as AppRegistry,
    supervisor: forbiddenSupervisor(),
    ...over,
  };
}

// `init` is spread FIRST and headers merged after: an init carrying its own
// `headers` would otherwise replace the object and drop the Host header, and a
// request with no Host is "not ours" — every assertion here would then pass
// against a fall-through instead of the behavior it names.
function req(host: string, path = "/", init: RequestInit = {}): Request {
  return new Request(`http://${host}${path}`, { ...init, headers: { host, ...((init.headers as Record<string, string>) ?? {}) } });
}

async function statusOf(result: ReturnType<typeof handleAppHostRequest>): Promise<number> {
  const res = await result;
  if (!res) throw new Error("expected a response");
  return res.status;
}

describe("app-host dispatch: what falls through to the office", () => {
  test("the office's own host is never diverted", () => {
    expect(handleAppHostRequest(req(DOMAIN), deps([record()]))).toBeNull();
    expect(handleAppHostRequest(req(`${DOMAIN}:4000`, "/api/agents"), deps([record()]))).toBeNull();
  });

  test("an office with no app-host domain diverts nothing at all", () => {
    expect(handleAppHostRequest(req("hello.office.example"), deps([record()], { domain: null }))).toBeNull();
  });

  test("a host outside the domain, or an unusable Host header, is not ours", () => {
    expect(handleAppHostRequest(req("elsewhere.test"), deps([record()]))).toBeNull();
    expect(handleAppHostRequest(req("localhost:4000"), deps([record()]))).toBeNull();
    // An unparseable Host means "not ours" — today's office behavior, never a
    // refusal.
    const bad = new Request("http://x/", { headers: { host: "[::1]:4000" } });
    expect(handleAppHostRequest(bad, deps([record()]))).toBeNull();
  });
});

describe("app-host dispatch: what is diverted", () => {
  test("a deeper name is inside the wildcard but can never name an app", async () => {
    expect(await statusOf(handleAppHostRequest(req("a.b.office.example"), deps([record()])))).toBe(404);
  });

  test("an unknown label and a retired one are the same 404", async () => {
    const apps = [record()];
    expect(await statusOf(handleAppHostRequest(req("never-existed.office.example"), deps(apps)))).toBe(404);
    // A recycled name lands on a fresh label, so the OLD label no longer
    // resolves — indistinguishable from one never issued.
    expect(await statusOf(handleAppHostRequest(req("hello.office.example"), deps([record({ hostLabel: "hello-g2", hostGen: 2 })])))).toBe(404);
  });

  test("a registry that cannot be read fails closed", async () => {
    const throwing = {
      list: () => {
        throw new Error("apps.json unreadable");
      },
    } as unknown as AppRegistry;
    expect(await statusOf(handleAppHostRequest(req("hello.office.example"), deps([], { registry: throwing })))).toBe(404);
  });

  test("the reserved namespace is never the app's, by any method or protocol", async () => {
    const apps = [record()];
    for (const path of [APP_RESERVED_PATH, `${APP_RESERVED_PATH}/anything`, `${APP_AUTH_PATH}/deeper`]) {
      expect(await statusOf(handleAppHostRequest(req("hello.office.example", path), deps(apps)))).toBe(404);
    }
    // A POST to the handshake's own path is not the handshake.
    expect(await statusOf(handleAppHostRequest(req("hello.office.example", APP_AUTH_PATH, { method: "POST" }), deps(apps)))).toBe(404);
    // An UPGRADE addressed at the handshake path must not redeem and then relay:
    // the reserved check runs ahead of the WebSocket branch for exactly this.
    const upgrade = req("hello.office.example", APP_AUTH_PATH, { headers: { upgrade: "websocket" } });
    expect(await statusOf(handleAppHostRequest(upgrade, deps(apps)))).toBe(404);
  });

  test("an unauthenticated request is answered by the gate, never by the app", async () => {
    // The forbidden supervisor proves it: reaching a relay would throw.
    const status = await statusOf(handleAppHostRequest(req("hello.office.example", "/", { headers: { "sec-fetch-mode": "cors" } }), deps([record()])));
    expect(status).toBe(401);
  });

  test("an unauthenticated navigation is bounced to the office to get a session", async () => {
    const res = await handleAppHostRequest(req("hello.office.example", "/dashboard", { headers: { "sec-fetch-mode": "navigate", "sec-fetch-dest": "document" } }), deps([record()]));
    expect(res?.status).toBe(302);
    // To the OFFICE, carrying the label and where to come back to.
    const location = res?.headers.get("location") ?? "";
    expect(location).toContain("/auth/app");
    expect(location).toContain("app=hello");
    expect(location).toContain(encodeURIComponent("/dashboard"));
  });

  test("an unauthenticated upgrade gets its own answer: it cannot follow a redirect", async () => {
    const upgrade = req("hello.office.example", "/socket", { headers: { upgrade: "websocket" } });
    const res = await handleAppHostRequest(upgrade, deps([record()]));

    expect(res?.status).toBeGreaterThanOrEqual(400);
    expect(res?.status).not.toBe(302);
  });
});
