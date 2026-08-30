import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import { createManagedAgent } from "../../agents/managed-factory.ts";
import { agents } from "../../agents/state.ts";
import * as AgentManager from "../../agent-manager.ts";
import { createAppRegistry } from "../../apps/registry.ts";
import { UNKNOWN_RUNTIME } from "../../apps/supervisor.ts";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { claimUserByName } from "../../users.ts";
import { handleAppsRequest } from "../apps.ts";
import type { AppsDeps } from "../apps-seam.ts";

let stateDir: string;
let deps: AppsDeps;

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), "bureau-app-visibility-"));
  deps = {
    registry: createAppRegistry({ dir: stateDir, probePort: () => true }),
    states: (names) => new Map(names.map((name) => [name, UNKNOWN_RUNTIME])),
    install: () => {},
    reinstall: () => {},
    teardown: () => {},
    start: () => {},
    stop: () => {},
    restart: () => {},
    logs: () => [],
    provisionToken: () => true,
    revokeToken: () => {},
    sendAsApp: () => ({ ok: true, messageId: "unused" }),
    limiter: { takeBurst: () => ({ ok: true }), commitDaily: () => {}, forget: () => {} },
    publicUrl: () => null,
    preview: async () => ({ ok: true, png: Buffer.from("png") }),
    invalidatePreview: () => {},
  };
});

afterEach(() => {
  agents.clear();
  if (stateDir.startsWith(tmpdir())) rmSync(stateDir, { recursive: true, force: true });
});

describe("app route visibility", () => {
  test("a member sharing the creator agent's room sees a launch-only projection", async () => {
    const room = AgentManager.getRooms()[0]!;
    installAgent("creator-agent", room.id);
    const viewer = claimUserByName(`Apps Viewer ${Date.now()}`, { role: "member", allowedRooms: [room.id] });
    const viewerAuth: AuthResult = {
      kind: "ok",
      session: { sessionIdHash: "h3", sessionPrefix: "s3", userId: viewer.id, username: viewer.name, role: "member", needsRolling: false, absoluteExpiresAt: Date.now() + 86_400_000 },
    };
    deps.registry.register({
      name: "room-app",
      command: "bun run serve",
      cwd: process.cwd(),
      userId: "user-1",
      username: "Ada",
      createdBy: "Creator",
      createdByAgentId: "creator-agent",
    });

    const list = await call("GET", "/api/apps", undefined, viewerAuth);
    expect(list.body.apps).toHaveLength(1);
    expect(list.body.apps[0]).toMatchObject({ name: "room-app", canManage: false, state: "unknown", restartCount: 0 });
    expect(list.body.apps[0].command).toBeUndefined();
    expect(list.body.apps[0].cwd).toBeUndefined();
    expect((await call("GET", "/api/apps/room-app/logs", undefined, viewerAuth)).status).toBe(404);
    expect((await call("POST", "/api/apps/room-app/restart", undefined, viewerAuth)).status).toBe(404);
  });
});

async function call(method: string, path: string, body?: unknown, auth?: AuthResult) {
  const request = new Request(`http://local.test${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const res = await handleAppsRequest(request, new URL(request.url), auth, deps);
  return { status: res?.status ?? 0, body: res && res.status !== 204 ? await res.json() : null };
}

function installAgent(id: string, roomId: string): void {
  const info: AgentInfo = {
    id,
    name: "Creator",
    desk: 0,
    room: AgentManager.getRooms().findIndex((room) => room.id === roomId),
    cwd: process.cwd(),
    outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: null,
  };
  agents.set(id, createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] }));
}
