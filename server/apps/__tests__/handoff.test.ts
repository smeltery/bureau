import * as AgentManager from "../../agent-manager.ts";
import { agents } from "../../agents/state.ts";
import { createManagedAgent } from "../../agents/managed-factory.ts";
import { claimUserByName, deleteUserById, updateUserById } from "../../users.ts";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { createAppRegistry } from "../../apps/registry.ts";
import { handleAppsRequest } from "../../http/apps.ts";
import type { AppsDeps } from "../../http/apps-seam.ts";
test("app handoffs persist, follow room access and preserve the human owner", async () => {
  const stateDir = mkdtempSync(join(tmpdir(), "bureau-handoff-"));
  const calls: string[] = [];
  const deps: AppsDeps = {
    registry: createAppRegistry({ dir: stateDir, probePort: () => true }),
    states: () => new Map(),
    install: () => {},
    reinstall: () => {
      calls.push("reinstall:handoff");
    },
    teardown: () => {},
    start: () => {},
    stop: () => {},
    restart: () => {},
    logs: () => [],
    provisionToken: () => true,
    revokeToken: () => {},
    sendAsApp: () => ({ ok: true }),
    limiter: { takeBurst: () => ({ ok: true }), commitDaily: () => {}, forget: () => {} },
    publicUrl: () => null,
    preview: async () => ({ ok: true, png: Buffer.from("") }),
    invalidatePreview: () => {},
  };
  async function call(method: string, path: string, body: unknown, auth: AuthResult) {
    const req = new Request(`http://local.test${path}`, { method, ...(body ? { body: JSON.stringify(body) } : {}) });
    const res = (await handleAppsRequest(req, new URL(req.url), auth, deps))!;
    return { status: res.status, body: await res.json() };
  }
  const room = AgentManager.getRooms()[0]!;
  const owner = claimUserByName(`App owner ${crypto.randomUUID()}`, { role: "member", allowedRooms: [room.id] });
  const reader = claimUserByName(`App reader ${crypto.randomUUID()}`, { role: "member", allowedRooms: [room.id] });
  const id = `app-target-${crypto.randomUUID()}`;
  const info = {
    id,
    name: "Target",
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: {},
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: null,
  } as AgentInfo;
  agents.set(id, createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] }));
  const session = (user: typeof owner): AuthResult => ({
    kind: "ok",
    session: { sessionIdHash: "hash", sessionPrefix: "sess", needsRolling: false, absoluteExpiresAt: Date.now() + 86400000, userId: user.id, username: user.name, role: user.role },
  });
  try {
    deps.registry.register({ name: "handoff", command: "run", cwd: process.cwd(), userId: owner.id, username: owner.name, createdBy: owner.name, createdByAgentId: id });
    expect((await call("GET", "/api/apps/handoff", undefined, session(reader))).status).toBe(200);
    expect((await call("PATCH", "/api/apps/handoff", { description: "unauthorized" }, session(reader))).status).toBe(404);
    expect((await call("PATCH", "/api/apps/handoff", { createdByAgentId: "missing" }, session(owner))).status).toBe(404);
    const result = await call("PATCH", "/api/apps/handoff", { createdByAgentId: id }, session(owner));
    expect(result.status).toBe(200);
    expect(result.body.userId).toBe(owner.id);
    expect(calls).not.toContain("reinstall:handoff");
    expect(createAppRegistry({ dir: stateDir }).get("handoff")?.createdByAgentId).toBe(id);
    updateUserById(owner.id, { allowedRooms: [] });
    expect((await call("PATCH", "/api/apps/handoff", { createdByAgentId: id }, { kind: "loopback" })).status).toBe(404);
  } finally {
    rmSync(stateDir, { recursive: true, force: true });
    agents.delete(id);
    deleteUserById(owner.id);
    deleteUserById(reader.id);
  }
});
