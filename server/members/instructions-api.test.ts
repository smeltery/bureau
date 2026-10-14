import { expect, test } from "bun:test";
import { mintApiToken, resolveApiToken, revokeApiToken } from "../auth/api-tokens.ts";
import { claimUserByName, deleteUserById } from "../users.ts";
import { handleMemberInstructions } from "./instructions-http.ts";
import { updateUserForApi } from "../http/access-adapters.ts";

test("personal tokens edit instructions within current member authority", async () => {
  const member = claimUserByName(`Token instructions ${crypto.randomUUID()}`, { role: "member", allowedRooms: [] });
  const other = claimUserByName(`Other instructions ${crypto.randomUUID()}`, { role: "member", allowedRooms: [] });
  const minted = await mintApiToken({ userId: member.id, name: "Instructions", expiresInDays: 30 });
  const auth = { kind: "api" as const, token: resolveApiToken(minted.token)! };
  const deps = {
    update: updateUserForApi,
    setAccess: async () => ({ ok: false as const, status: 403, error: "forbidden" }),
    delete: async () => ({ ok: false as const, status: 403, error: "forbidden" }),
  };
  async function call(name: string, body?: unknown) {
    const req = new Request("http://localhost/api/users/member/member-prompt", {
      method: body ? "PATCH" : "GET",
      headers: { Authorization: `Bearer ${minted.token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    return handleMemberInstructions(req, name, auth, deps);
  }
  try {
    const read = await call(member.name);
    expect(read.status).toBe(200);
    const snapshot = await read.json();
    expect(Object.keys(snapshot).sort()).toEqual(["memberPrompt", "memberPromptVersion"]);
    expect((await call(other.name)).status).toBe(404);
    expect((await call(member.name, { ...snapshot, memberPrompt: "Use concise replies." })).status).toBe(200);
    expect((await call(member.name, { ...snapshot, memberPrompt: "Stale" })).status).toBe(409);
    expect((await call(member.name, { ...snapshot, role: "owner" })).status).toBe(400);
    await revokeApiToken(member.id, minted.apiToken.id);
    expect((await call(member.name)).status).toBe(403);
  } finally {
    await revokeApiToken(member.id, minted.apiToken.id);
    deleteUserById(member.id);
    deleteUserById(other.id);
  }
});
