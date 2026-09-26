import { afterEach, describe, expect, it } from "bun:test";
import { getBackend } from "../index.ts";
import type { CreateSessionOptions, NormalizedEvent } from "../types.ts";
import { createOpenCodeBackend } from "./adapter.ts";
import { OPENCODE_AUTH_FAILURE, CAPABILITIES, DEFAULT_OPENCODE_MODEL, MODEL_OPTIONS, permissionAgent } from "./config.ts";
import type { OpenCodeLease, OpenCodeSupervisor } from "./supervisor.ts";

const cleanup: Array<() => void | Promise<void>> = [];
afterEach(async () => {
  for (const dispose of cleanup.splice(0).reverse()) await dispose();
});

const opts: CreateSessionOptions = {
  agentId: "agent-opencode-test",
  cwd: "/tmp",
  systemPrompt: "test",
  modelFamily: DEFAULT_OPENCODE_MODEL,
  effort: "high",
  permissionMode: "default",
};

function mockSupervisor(handlers: { onProvider?: () => unknown; onSession?: () => unknown }): OpenCodeSupervisor {
  const server = Bun.serve({
    port: 0,
    fetch(req) {
      const url = new URL(req.url);
      if (url.pathname === "/provider") {
        return Response.json(
          handlers.onProvider?.() ?? {
            connected: ["opencode"],
            all: [
              {
                id: "opencode",
                name: "OpenCode",
                models: {
                  "gpt-5-nano": { name: "GPT-5 Nano", cost: { input: 0, output: 0, cache: { read: 0, write: 0 } }, limit: { context: 128000 } },
                },
              },
            ],
          },
        );
      }
      if (url.pathname === "/session" && req.method === "POST") {
        return Response.json(handlers.onSession?.() ?? { id: "sess-mock-1" });
      }
      if (url.pathname === "/event") {
        return new Response("", { status: 200, headers: { "content-type": "text/event-stream" } });
      }
      return new Response("not found", { status: 404 });
    },
  });
  cleanup.push(() => server.stop(true));
  const lease: OpenCodeLease = {
    baseUrl: `http://127.0.0.1:${server.port}`,
    authHeader: `Basic ${btoa("bureau:test")}`,
    pid: 1,
    release() {},
    async beginTurn() {},
    async recoverBeforePrompt() {},
    endTurn() {},
  };
  return {
    acquire: async () => lease,
    shutdown: async () => undefined,
  } as unknown as OpenCodeSupervisor;
}

async function takeInit(stream: AsyncIterable<NormalizedEvent>): Promise<NormalizedEvent> {
  for await (const event of stream) return event;
  throw new Error("stream ended");
}

describe("OpenCode backend registry", () => {
  it("registers opencode with honest capability flags", () => {
    const backend = getBackend("opencode");
    expect(backend.capabilities).toEqual(CAPABILITIES);
    expect(backend.capabilities.skills).toBe(false);
    expect(backend.capabilities.hooks).toBe(false);
    expect(backend.capabilities.mcp).toBe(false);
  });

  it("keeps AgentBackendType exhaustiveness in getBackend", () => {
    expect(() => getBackend("claude")).not.toThrow();
    expect(() => getBackend("codex")).not.toThrow();
    expect(() => getBackend("opencode")).not.toThrow();
  });
});

describe("OpenCode permissionAgent", () => {
  it("maps bypass to the unattended cron agent", () => {
    expect(permissionAgent("default")).toBeUndefined();
    expect(permissionAgent("bypassPermissions")).toBe("bureau-cron");
  });
});

describe("createOpenCodeBackend", () => {
  it("detectAuthError matches known auth failure text", () => {
    const backend = createOpenCodeBackend({ supervisor: mockSupervisor({}) });
    expect(backend.detectAuthError(OPENCODE_AUTH_FAILURE)).toBe(true);
    expect(backend.detectAuthError("OpenCode HTTP 401 at /session")).toBe(true);
    expect(backend.detectAuthError("model not found")).toBe(false);
  });

  it("getLoginInstructions points at Connections / env and host login", () => {
    const backend = createOpenCodeBackend({ supervisor: mockSupervisor({}) });
    const bare = backend.getLoginInstructions();
    expect(bare.text).toContain("OPENCODE_API_KEY");
    expect(bare.text).toContain("Individual connections");
    expect(bare.commands).toEqual(["opencode auth login"]);
    const withKey = backend.getLoginInstructions({ env: { OPENCODE_API_KEY: "sk-test" } });
    expect(withKey.text).toContain("OPENCODE_API_KEY");
    expect(withKey.commands).toBeUndefined();
  });

  it("listModels returns discovered models from mocked transport", async () => {
    const backend = createOpenCodeBackend({ supervisor: mockSupervisor({}) });
    const models = await backend.listModels({ cwd: "/tmp" });
    expect(models.some((m) => m.id === "opencode/gpt-5-nano")).toBe(true);
    expect(models[0].supportedEfforts).toEqual([]);
  });

  it("listModels falls back to static options when discovery fails", async () => {
    const backend = createOpenCodeBackend({
      supervisor: {
        acquire: async () => {
          throw new Error("no server");
        },
        shutdown: async () => undefined,
      } as unknown as OpenCodeSupervisor,
    });
    const models = await backend.listModels({ cwd: "/tmp" });
    expect(models.map((m) => m.id)).toEqual(MODEL_OPTIONS.map((m) => m.value));
    expect(models[0].id).toBe(DEFAULT_OPENCODE_MODEL);
    expect(models[0].label).toContain("free");
  });

  it("createSession emits system_init with the OpenCode session id", async () => {
    const backend = createOpenCodeBackend({ supervisor: mockSupervisor({}) });
    const session = backend.createSession(opts);
    // Kick initialize via an empty send path that still opens the session:
    // initialize is deferred until send; call transport via a short-lived send
    // that fails the event stream but still yields system_init first.
    const initPromise = takeInit(session.stream());
    await session.send("hi");
    const init = await initPromise;
    expect(init).toMatchObject({ kind: "system_init", sessionId: "sess-mock-1", model: DEFAULT_OPENCODE_MODEL });
    session.close();
  });
});
