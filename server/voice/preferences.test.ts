import { expect, test } from "bun:test";
import { applyBootstrapUserChanges, createUserRecord } from "../user-record-updates.ts";
import { handleUsersRequest } from "../http/users.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";

test("member voice preferences preserve defaults, reject invalid values and pass through the profile endpoint", async () => {
  const user = createUserRecord({ id: "member", name: "Member", role: "member", allowedRooms: [] });
  expect(user.voiceInput).toBeUndefined();
  const changes = { voiceInput: "openai" as const, voiceOutput: "browser" as const, voiceName: "cedar" as const };
  expect(applyBootstrapUserChanges(user, changes)).toMatchObject(changes);
  expect(applyBootstrapUserChanges(user, { voiceInput: "invalid" as any }).voiceInput).toBeUndefined();
  let calls = 0;
  const deps = {
    update: async (_id: string, _role: string, _name: string, update: unknown) => {
      calls++;
      expect(update).toEqual(changes);
      return { ok: true as const, user };
    },
    setAccess: async () => ({ ok: true as const, user }),
    delete: async () => ({ ok: true as const }),
  };
  for (const body of [changes, { voiceInput: "unknown" }, { voiceOutput: 42 }, { voiceName: "unknown" }]) {
    const request = new Request("https://office.example/api/users/Member", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const response = await handleUsersRequest(request, new URL(request.url), { kind: "ok", session: { userId: "member", role: "member" } } as AuthResult, deps);
    expect(response?.status).toBe(body === changes ? 200 : 422);
  }
  expect(calls).toBe(1);
});
