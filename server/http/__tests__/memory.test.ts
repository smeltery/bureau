import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleMemoryRequest } from "../memory.ts";

const auth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash",
    sessionPrefix: "sess",
    userId: "user-1",
    username: "Boss",
    role: "owner",
    needsRolling: false,
  },
};

describe("handleMemoryRequest", () => {
  test("returns null for unrelated api routes", async () => {
    const req = new Request("http://local.test/api/tasks");

    await expect(handleMemoryRequest(req, new URL(req.url), auth)).resolves.toBeNull();
  });

  test("requires an authenticated caller", async () => {
    const req = new Request("http://local.test/api/memory?scope=office");

    const res = await handleMemoryRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({
      error: { code: "unauthenticated", message: "authenticated caller required" },
    });
  });

  test("allows browser sessions to read memory", async () => {
    const req = new Request("http://local.test/api/memory?scope=office");

    const res = await handleMemoryRequest(req, new URL(req.url), auth);
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(typeof body.text).toBe("string");
    expect(typeof body.version).toBe("string");
  });
});
