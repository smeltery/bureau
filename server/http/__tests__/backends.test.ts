import { describe, expect, spyOn, test } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as users from "../../users.ts";
import * as AgentManager from "../../agent-manager.ts";
import type { UserRecord, AgentInfo } from "../../../shared/types.ts";
import { getBackend } from "../../backends/index.ts";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleBackendsRequest } from "../backends.ts";

const ownerAuth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash",
    sessionPrefix: "sess",
    userId: "owner-1",
    username: "Owner",
    role: "owner",
    needsRolling: false,
    absoluteExpiresAt: Date.now() + 86_400_000,
  },
};

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://local.test${path}`, init);
}

describe("handleBackendsRequest", () => {
  test("returns null for unrelated /api routes", async () => {
    const req = request("/api/validate/cwd");

    await expect(handleBackendsRequest(req, new URL(req.url), ownerAuth)).resolves.toBeNull();
  });

  test("requires a browser session for backend routes", async () => {
    const req = request("/api/backends/claude/models");

    const res = await handleBackendsRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ models: [], error: "authenticated browser session required" });
  });

  test("returns Claude backend models", async () => {
    const req = request(`/api/backends/claude/models?cwd=${encodeURIComponent(process.cwd())}`);

    const res = await handleBackendsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(200);
    const body = await res?.json();
    expect(body.models.length).toBeGreaterThan(0);
    expect(body.models[0]).toHaveProperty("id");
    expect(body.models[0]).toHaveProperty("label");
    expect(body.models[0]).toHaveProperty("supportedEfforts");
  });

  test("exposes OpenCode model variants through the authenticated catalog route", async () => {
    const models = [{ id: "test/model", label: "Test model", supportedEfforts: [{ level: "high" }] }];
    const list = spyOn(getBackend("opencode"), "listModels").mockResolvedValue(models);
    try {
      const req = request(`/api/backends/opencode/models?cwd=${encodeURIComponent(process.cwd())}`);
      const res = await handleBackendsRequest(req, new URL(req.url), ownerAuth);
      expect(res?.status).toBe(200);
      expect(await res?.json()).toEqual({ models });
    } finally {
      list.mockRestore();
    }
  });

  test("rejects unknown backend names", async () => {
    const req = request("/api/backends/other/models");

    const res = await handleBackendsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ models: [], error: "unknown backend" });
  });

  test("returns cwd validation errors before listing models", async () => {
    const req = request("/api/backends/claude/models?cwd=/definitely/not/a/real/directory");

    const res = await handleBackendsRequest(req, new URL(req.url), ownerAuth);

    expect(res?.status).toBe(200);
    const body = await res?.json();
    expect(body.models).toEqual([]);
    expect(body.error).toContain("Directory does not exist");
  });
});

describe("backend model environment access", () => {
  test("uses office, room, and agent-manager environment precedence", async () => {
    const root = mkdtempSync(join(tmpdir(), "bureau-model-env-"));
    const office = join(root, "office.env"),
      room = join(root, "room.env"),
      manager = join(root, "manager.env");
    writeFileSync(office, "CLAUDE_CODE_USE_BEDROCK=1\nMODEL_TEST_LEVEL=office\n");
    writeFileSync(room, "ANTHROPIC_DEFAULT_HAIKU_MODEL=claude-haiku-5-5\nMODEL_TEST_LEVEL=room\n");
    writeFileSync(manager, "MODEL_TEST_LEVEL=manager\n");
    const userMap: Record<string, UserRecord> = {
      "owner-1": { id: "owner-1", role: "owner", allowedRooms: [] } as unknown as UserRecord,
      "manager-1": { id: "manager-1", role: "member", allowedRooms: ["room-1"], envFile: manager } as unknown as UserRecord,
    };
    const spies = [
      spyOn(users, "getUserById").mockImplementation((id) => userMap[id] ?? null),
      spyOn(AgentManager, "getAgent").mockReturnValue({ id: "agent-1", userId: "manager-1", roomId: "room-1" } as AgentInfo),
      spyOn(AgentManager, "getRoomSettings").mockReturnValue({ envFile: room, prompt: null, pet: null, skin: null, decor: null }),
      spyOn(AgentManager, "getOfficeSettings").mockReturnValue({ ...AgentManager.getOfficeSettings(), envFile: office }),
    ];
    const list = spyOn(getBackend("claude"), "listModels").mockImplementation(async (opts) => {
      expect(opts.env?.MODEL_TEST_LEVEL).toBe("manager");
      expect(opts.env?.CLAUDE_CODE_USE_BEDROCK).toBe("1");
      expect(opts.env?.ANTHROPIC_DEFAULT_HAIKU_MODEL).toBe("claude-haiku-5-5");
      return [];
    });
    try {
      const req = request(`/api/backends/claude/models?agentId=agent-1&cwd=${encodeURIComponent(process.cwd())}`);
      expect((await handleBackendsRequest(req, new URL(req.url), ownerAuth))?.status).toBe(200);
      expect(list).toHaveBeenCalledTimes(1);
    } finally {
      list.mockRestore();
      for (const spy of spies.reverse()) spy.mockRestore();
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("refuses hidden rooms and another member's selected environment", async () => {
    const member = { ...ownerAuth, session: { ...ownerAuth.session, role: "member" as const } } as AuthResult;
    const user = spyOn(users, "getUserById").mockReturnValue({ id: "owner-1", role: "member", allowedRooms: [] } as unknown as UserRecord);
    const room = spyOn(AgentManager, "getRoomSettings").mockReturnValue({ envFile: null, prompt: null, pet: null, skin: null, decor: null });
    try {
      for (const [query, status] of [
        ["roomId=hidden", 404],
        ["userId=other", 403],
      ] as const) {
        const req = request(`/api/backends/claude/models?${query}`);
        expect((await handleBackendsRequest(req, new URL(req.url), member))?.status).toBe(status);
      }
    } finally {
      room.mockRestore();
      user.mockRestore();
    }
  });
});
