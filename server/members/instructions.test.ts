import { expect, test } from "bun:test";
import { claimUserByName, deleteUserById, getUserById, updateUser } from "../users.ts";
import { mintAgentToken, revokeAgentToken } from "../agents/tokens.ts";
import { handleUsersRequest } from "../http/users.ts";
import { updateUserForApi } from "../http/access-adapters.ts";
import { instructionSnapshot } from "./instructions.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";

test("privileged instruction edits enforce authority, versions and a narrow response", async () => {
  const manager = claimUserByName(`Instructions ${crypto.randomUUID()}`, { role: "member", allowedRooms: [] });
  const other = claimUserByName(`Other ${crypto.randomUUID()}`, { role: "member", allowedRooms: [] });
  const agentId = `instructions-${crypto.randomUUID()}`;
  const token = mintAgentToken(agentId, manager.id, true);
  const deps = {
    update: updateUserForApi,
    setAccess: async () => ({ ok: false as const, status: 403, error: "forbidden" }),
    delete: async () => ({ ok: false as const, status: 403, error: "forbidden" }),
  };
  async function call(method: string, name: string, body?: unknown, authorization = token) {
    const req = new Request(`http://localhost/api/users/${encodeURIComponent(name)}/member-prompt`, {
      method,
      headers: { Authorization: `Bearer ${authorization}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    const response = (await handleUsersRequest(req, new URL(req.url), { kind: "loopback" }, deps))!;
    return { status: response.status, body: await response.json() };
  }
  try {
    const read = await call("GET", manager.name);
    expect(read.status).toBe(200);
    expect(Object.keys(read.body).sort()).toEqual(["memberPrompt", "memberPromptVersion"]);
    expect((await call("GET", other.name)).status).toBe(404);
    expect((await call("GET", manager.name, undefined, "invalid")).status).toBe(403);
    expect((await call("PATCH", manager.name, { memberPrompt: "first" })).status).toBe(400);
    expect((await call("PATCH", manager.name, { ...read.body, role: "owner" })).status).toBe(400);
    expect((await call("PATCH", manager.name, { ...read.body, memberPrompt: "first" })).status).toBe(200);
    const stale = await call("PATCH", manager.name, { ...read.body, memberPrompt: "stale" });
    expect(stale.status).toBe(409);
    expect(stale.body.memberPrompt).toBe("first");
    expect(getUserById(manager.id)?.role).toBe("member");
    expect(updateUser(getUserById(manager.id), manager.id, { memberPrompt: "unguarded" }, [])).toBeNull();
    expect(instructionSnapshot(getUserById(manager.id)!).memberPrompt).toBe("first");
    const auth: AuthResult = {
      kind: "ok",
      session: { userId: manager.id, username: manager.name, role: "member", sessionIdHash: "hash", sessionPrefix: "s", needsRolling: false, absoluteExpiresAt: Date.now() + 10000 },
    };
    const req = new Request(`http://localhost/api/users/${encodeURIComponent(manager.name)}/member-prompt`);
    expect((await handleUsersRequest(req, new URL(req.url), auth, deps))?.status).toBe(200);
  } finally {
    revokeAgentToken(agentId);
    deleteUserById(manager.id);
    deleteUserById(other.id);
  }
});
