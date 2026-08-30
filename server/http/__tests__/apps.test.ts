import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { createAppRegistry } from "../../apps/registry.ts";
import { UNKNOWN_RUNTIME, type AppRuntime } from "../../apps/supervisor.ts";
import { handleAppsRequest } from "../apps.ts";
import type { AppsDeps } from "../apps-seam.ts";
import type { AppRecord } from "../../../shared/apps.ts";

// The route layer only: the registry is real (pointed at a temp dir) so the
// commit-order rules are exercised against the thing that actually persists,
// while the supervisor seam is a fake that records calls — no systemd is
// touched, and an install/teardown failure is scriptable.

let stateDir: string;
let deps: AppsDeps;
let calls: string[];
let installThrows: Error | null;
let teardownThrows: Error | null;
let revokeThrows: Error | null;
let runtimes: Map<string, AppRuntime>;

const ownerAuth: AuthResult = {
  kind: "ok",
  session: { sessionIdHash: "hash", sessionPrefix: "sess", userId: "user-1", username: "Ada", role: "owner", needsRolling: false, absoluteExpiresAt: Date.now() + 86_400_000 },
};

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "bureau-apps-routes-"));
  calls = [];
  installThrows = null;
  teardownThrows = null;
  revokeThrows = null;
  runtimes = new Map();
  deps = {
    registry: createAppRegistry({ dir: stateDir, probePort: () => true }),
    states: (names) => new Map(names.map((n) => [n, runtimes.get(n) ?? UNKNOWN_RUNTIME])),
    install: (record) => {
      calls.push(`install:${record.name}`);
      if (installThrows) throw installThrows;
    },
    reinstall: (record) => {
      calls.push(`reinstall:${record.name}`);
    },
    teardown: (name) => {
      calls.push(`teardown:${name}`);
      if (teardownThrows) throw teardownThrows;
    },
    start: (name) => {
      calls.push(`start:${name}`);
    },
    stop: (name) => {
      calls.push(`stop:${name}`);
    },
    restart: (name) => {
      calls.push(`restart:${name}`);
    },
    logs: (name, lines) => {
      calls.push(`logs:${name}:${lines}`);
      return [`line for ${name}`];
    },
    provisionToken: (record) => {
      calls.push(`provisionToken:${record.name}`);
      return true;
    },
    revokeToken: (name) => {
      calls.push(`revokeToken:${name}`);
      if (revokeThrows) throw revokeThrows;
    },
    // The app-self surface has its own test file; these routes never send.
    sendAsApp: () => ({ ok: true, messageId: "unused" }),
    limiter: {
      takeBurst: () => ({ ok: true }),
      commitDaily: () => {},
      forget: (name) => {
        calls.push(`forget:${name}`);
      },
    },
    publicUrl: () => null,
    preview: async () => ({ ok: true, png: Buffer.from("png") }),
    invalidatePreview: (name) => {
      calls.push(`invalidatePreview:${name}`);
    },
  };
});

afterEach(() => {
  // Guarded: only ever the temp dir this file made.
  if (stateDir.startsWith(tmpdir())) rmSync(stateDir, { recursive: true, force: true });
});

function req(method: string, path: string, body?: unknown): Request {
  return new Request(`http://local.test${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function call(method: string, path: string, body?: unknown, auth: AuthResult = ownerAuth) {
  const request = req(method, path, body);
  const res = await handleAppsRequest(request, new URL(request.url), auth, deps);
  return { status: res?.status ?? 0, body: res && res.status !== 204 ? await res.json() : null };
}

async function register(name: string, extra: Record<string, unknown> = {}) {
  return call("POST", "/api/apps", { name, command: "bun run start", cwd: process.cwd(), ...extra });
}

describe("apps routes: registration", () => {
  test("registering allocates a port and a data dir and answers 201", async () => {
    const { status, body } = await register("hello");

    expect(status).toBe(201);
    expect(body.name).toBe("hello");
    expect(body.port).toBeGreaterThanOrEqual(21000);
    expect(body.dataDir).toContain("hello");
    // Ownership comes from the identity, never the body.
    expect(body.userId).toBe("user-1");
    expect(body.username).toBe("Ada");
    // Derived, never stored: no supervisor has spoken for it yet.
    expect(body.state).toBe("unknown");
    // The token BEFORE the install, so the unit's first start already has it:
    // a process's environment is fixed at exec.
    expect(calls).toEqual(["provisionToken:hello", "install:hello"]);
  });

  test("a body-supplied owner cannot register an app onto someone else", async () => {
    const { body } = await register("hello", { userId: "someone-else", username: "Mallory", createdBy: "Mallory" });

    expect(body.userId).toBe("user-1");
    expect(body.username).toBe("Ada");
  });

  test("a failed install still answers 201: the record committed", async () => {
    installThrows = new Error("systemd said no");

    const { status, body } = await register("hello");

    expect(status).toBe(201);
    expect(body.name).toBe("hello");
    // The app exists and start/update can still fix it.
    expect(deps.registry.get("hello")).not.toBeNull();
  });

  test("rejects a missing name, command, or cwd before touching the registry", async () => {
    expect((await call("POST", "/api/apps", { command: "x", cwd: "." })).status).toBe(400);
    expect((await call("POST", "/api/apps", { name: "a", cwd: "." })).status).toBe(400);
    expect((await call("POST", "/api/apps", { name: "a", command: "x" })).status).toBe(400);
    expect(deps.registry.list()).toEqual([]);
  });

  test("a taken name is 409, and the refusal carries the registry's code", async () => {
    await register("hello");
    const { status, body } = await register("hello");

    expect(status).toBe(409);
    expect(body.error.code).toBe("name_taken");
  });

  test("a reserved name is refused", async () => {
    const { status, body } = await register("bureau");

    expect(status).toBe(400);
    expect(body.error.code).toBe("reserved_name");
  });

  test("a nonexistent cwd is a 400, not a 500", async () => {
    const { status, body } = await call("POST", "/api/apps", { name: "hello", command: "x", cwd: "/definitely/not/here" });

    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_cwd");
  });
});

describe("apps routes: reads", () => {
  test("listing carries derived runtime, and one lookup covers the whole list", async () => {
    await register("one");
    await register("two");
    runtimes.set("one", { state: "running", restartCount: 2 });

    const { status, body } = await call("GET", "/api/apps");

    expect(status).toBe(200);
    expect(body.apps.map((a: { name: string }) => a.name).sort()).toEqual(["one", "two"]);
    const one = body.apps.find((a: { name: string }) => a.name === "one");
    expect(one.state).toBe("running");
    expect(one.restartCount).toBe(2);
  });

  test("a startError rides the wire; url is absent while there are no app hostnames", async () => {
    await register("one");
    runtimes.set("one", { state: "failed", restartCount: 5, startError: "exit 1" });

    const { body } = await call("GET", "/api/apps/one");

    expect(body.startError).toBe("exit 1");
    expect("url" in body).toBe(false);
  });

  test("a running visible app exposes a PNG preview", async () => {
    await register("one");
    runtimes.set("one", { state: "running", restartCount: 0 });

    const request = req("GET", "/api/apps/one/preview");
    const res = await handleAppsRequest(request, new URL(request.url), ownerAuth, deps);

    expect(res?.status).toBe(200);
    expect(res?.headers.get("Content-Type")).toBe("image/png");
    expect(Buffer.from(await res!.arrayBuffer()).toString()).toBe("png");
  });

  test("an unknown name is 404", async () => {
    expect((await call("GET", "/api/apps/nope")).status).toBe(404);
  });

  test("an unknown sub-resource falls through rather than 404ing", async () => {
    for (const path of ["/api/apps/one/logs/extra", "/api/apps/one/nonsense"]) {
      const request = req("GET", path);
      expect(await handleAppsRequest(request, new URL(request.url), ownerAuth, deps)).toBeNull();
    }
  });
});

describe("apps routes: control verbs and logs", () => {
  test("each verb runs and answers with the app's fresh state", async () => {
    await register("hello");
    runtimes.set("hello", { state: "running", restartCount: 0 });
    calls.length = 0;

    for (const verb of ["start", "stop", "restart"] as const) {
      const { status, body } = await call("POST", `/api/apps/hello/${verb}`);
      expect(status).toBe(200);
      expect(body.state).toBe("running");
    }
    expect(calls).toEqual(["start:hello", "invalidatePreview:hello", "stop:hello", "invalidatePreview:hello", "restart:hello", "invalidatePreview:hello"]);
  });

  test("a verb that throws announces nothing and carries the supervisor's code", async () => {
    await register("hello");
    const { AppSupervisorError } = await import("../../apps/supervisor.ts");
    deps.start = () => {
      throw new AppSupervisorError("supervisor_failed", "systemd refused");
    };

    const { status, body } = await call("POST", "/api/apps/hello/start");

    expect(status).toBe(500);
    expect(body.error.code).toBe("supervisor_failed");
  });

  test("a control verb on an unknown app is 404 and runs nothing", async () => {
    expect((await call("POST", "/api/apps/nope/start")).status).toBe(404);
    expect(calls).toEqual([]);
  });

  test("logs default to the supervisor's default line count", async () => {
    await register("hello");
    calls.length = 0;

    const { status, body } = await call("GET", "/api/apps/hello/logs");

    expect(status).toBe(200);
    expect(body).toEqual({ name: "hello", lines: ["line for hello"] });
    expect(calls).toEqual(["logs:hello:100"]);
  });

  test("an explicit line count is passed through; nonsense is refused", async () => {
    await register("hello");

    expect((await call("GET", "/api/apps/hello/logs?lines=25")).status).toBe(200);
    expect(calls).toContain("logs:hello:25");
    for (const bad of ["banana", "-5", "0", "1.5"]) {
      const { status, body } = await call("GET", `/api/apps/hello/logs?lines=${bad}`);
      expect(status).toBe(400);
      expect(body.error.code).toBe("invalid_request");
    }
  });

  test("a member cannot read another user's logs", async () => {
    await register("owned-by-ada");
    const memberAuth: AuthResult = {
      kind: "ok",
      session: { sessionIdHash: "h2", sessionPrefix: "s2", userId: "user-2", username: "Bo", role: "member", needsRolling: false, absoluteExpiresAt: Date.now() + 86_400_000 },
    };

    expect((await call("GET", "/api/apps/owned-by-ada/logs", undefined, memberAuth)).status).toBe(404);
  });
});

describe("apps routes: update", () => {
  test("a command change is persisted and the unit is brought in line", async () => {
    await register("hello");
    calls.length = 0;

    const { status, body } = await call("PATCH", "/api/apps/hello", { command: "bun run other" });

    expect(status).toBe(200);
    expect(body.command).toBe("bun run other");
    expect(calls).toEqual(["reinstall:hello", "invalidatePreview:hello"]);
  });

  test("a description-only edit never bounces the process", async () => {
    await register("hello");
    calls.length = 0;

    const { status, body } = await call("PATCH", "/api/apps/hello", { description: "the blurb" });

    expect(status).toBe(200);
    expect(body.description).toBe("the blurb");
    expect(calls).toEqual([]);
  });

  test("null removes a description; absent leaves it alone", async () => {
    await register("hello", { description: "first" });

    expect((await call("PATCH", "/api/apps/hello", { description: null })).body.description).toBeUndefined();
    expect((await call("PATCH", "/api/apps/hello", { command: "x" })).body.description).toBeUndefined();
  });

  test("renaming and re-porting are refused, but echoing the current values is not", async () => {
    const { body: before } = await register("hello");

    expect((await call("PATCH", "/api/apps/hello", { name: "other", command: "x" })).status).toBe(400);
    expect((await call("PATCH", "/api/apps/hello", { port: 21999, command: "x" })).status).toBe(400);
    // The natural read-modify-write body carries the app's own name and port.
    expect((await call("PATCH", "/api/apps/hello", { name: before.name, port: before.port, command: "x" })).status).toBe(200);
  });

  test("an empty patch is a caller mistake, not a no-op", async () => {
    await register("hello");
    const { status, body } = await call("PATCH", "/api/apps/hello", {});

    expect(status).toBe(400);
    expect(body.error.code).toBe("invalid_request");
  });

  test("a failed reinstall still answers 200: the record already changed", async () => {
    await register("hello");
    deps.reinstall = () => {
      throw new Error("systemd said no");
    };

    const { status, body } = await call("PATCH", "/api/apps/hello", { command: "bun run other" });

    expect(status).toBe(200);
    expect(body.command).toBe("bun run other");
  });

  test("patching an unknown app is 404", async () => {
    expect((await call("PATCH", "/api/apps/nope", { command: "x" })).status).toBe(404);
  });
});

describe("apps routes: delete", () => {
  test("teardown runs before the record is removed, freeing name and port", async () => {
    const { body: first } = await register("hello");
    calls.length = 0;

    const { status } = await call("DELETE", "/api/apps/hello");

    expect(status).toBe(204);
    expect(calls[0]).toBe("teardown:hello");
    expect(deps.registry.get("hello")).toBeNull();
    // The name is reusable; the LABEL is not — the successor gets a fresh one.
    const { body: second } = await register("hello");
    expect(second.hostLabel).not.toBe(first.hostLabel);
  });

  test("a failed teardown keeps the record, so a retry can finish the job", async () => {
    await register("hello");
    teardownThrows = new Error("unit still running");

    await expect(call("DELETE", "/api/apps/hello")).rejects.toThrow("unit still running");
    expect(deps.registry.get("hello")).not.toBeNull();
  });

  test("the token is revoked between teardown and removal, and the budget after", async () => {
    await register("hello");
    calls.length = 0;

    await call("DELETE", "/api/apps/hello");

    // Revoke while the record still exists (so a retry can finish the job),
    // forget the rate limit only once the removal committed.
    expect(calls).toEqual(["teardown:hello", "revokeToken:hello", "forget:hello", "invalidatePreview:hello"]);
  });

  test("a failed revoke keeps the record: a credential outliving its app is worth a retry", async () => {
    await register("hello");
    revokeThrows = new Error("token store unwritable");

    await expect(call("DELETE", "/api/apps/hello")).rejects.toThrow("token store unwritable");
    expect(deps.registry.get("hello")).not.toBeNull();
  });

  test("deleting an unknown app is 404 and tears nothing down", async () => {
    expect((await call("DELETE", "/api/apps/nope")).status).toBe(404);
    expect(calls).toEqual([]);
  });
});

describe("apps routes: visibility and auth", () => {
  const memberAuth: AuthResult = {
    kind: "ok",
    session: { sessionIdHash: "h2", sessionPrefix: "s2", userId: "user-2", username: "Bo", role: "member", needsRolling: false, absoluteExpiresAt: Date.now() + 86_400_000 },
  };

  test("an unauthenticated caller gets 401", async () => {
    const request = req("GET", "/api/apps");
    const res = await handleAppsRequest(request, new URL(request.url), undefined, deps);

    expect(res?.status).toBe(401);
  });

  test("a member sees only their own apps, and cannot read another user's by name", async () => {
    await register("owned-by-ada");
    const mine = await call("POST", "/api/apps", { name: "owned-by-bo", command: "x", cwd: process.cwd() }, memberAuth);
    expect(mine.status).toBe(201);

    const { body } = await call("GET", "/api/apps", undefined, memberAuth);
    expect(body.apps.map((a: { name: string }) => a.name)).toEqual(["owned-by-bo"]);
    expect((await call("GET", "/api/apps/owned-by-ada", undefined, memberAuth)).status).toBe(404);
  });

  test("an office owner sees every app", async () => {
    await call("POST", "/api/apps", { name: "owned-by-bo", command: "x", cwd: process.cwd() }, memberAuth);

    const { body } = await call("GET", "/api/apps");

    expect(body.apps.map((a: { name: string }) => a.name)).toEqual(["owned-by-bo"]);
  });

  test("a loopback shell caller can register, and the app has no owner", async () => {
    const { status, body } = await call("POST", "/api/apps", { name: "local-app", command: "x", cwd: process.cwd() }, { kind: "loopback" });

    expect(status).toBe(201);
    expect(body.userId).toBeNull();
    expect(body.createdBy).toBe("local");
  });

  test("a malformed bearer token is refused rather than falling back to the session", async () => {
    const request = new Request("http://local.test/api/apps", { headers: { Authorization: "Bearer not-a-real-token" } });
    const res = await handleAppsRequest(request, new URL(request.url), ownerAuth, deps);

    expect(res?.status).toBe(401);
  });
});
