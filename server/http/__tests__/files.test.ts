import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleFilesRequest } from "../files.ts";

const auth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash-1",
    sessionPrefix: "sess",
    userId: "owner-1",
    username: "Owner",
    role: "owner",
    needsRolling: false,
    absoluteExpiresAt: Date.now() + 86_400_000,
  },
};

describe("handleFilesRequest", () => {
  test("returns null for unrelated api routes", async () => {
    const req = new Request("http://local.test/api/tasks");

    await expect(handleFilesRequest(req, new URL(req.url), auth)).resolves.toBeNull();
  });

  test("accepts agent upload aliases", async () => {
    const req = new Request("http://local.test/api/agents/missing/uploads", {
      method: "POST",
    });

    const res = await handleFilesRequest(req, new URL(req.url), auth);

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "agent not found" });
  });

  test("accepts agent file-serving aliases", async () => {
    const req = new Request("http://local.test/api/agents/missing/files/example.txt");

    const res = await handleFilesRequest(req, new URL(req.url), auth);

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "agent not found" });
  });

  test("keeps legacy upload paths working", async () => {
    const req = new Request("http://local.test/api/upload/missing", {
      method: "POST",
    });

    const res = await handleFilesRequest(req, new URL(req.url), auth);

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "agent not found" });
  });

  test("requires a browser session for legacy upload paths", async () => {
    const req = new Request("http://local.test/api/upload/missing", {
      method: "POST",
    });

    const res = await handleFilesRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });

  test("keeps legacy file-serving paths working", async () => {
    const req = new Request("http://local.test/api/files/missing/example.txt");

    const res = await handleFilesRequest(req, new URL(req.url), auth);

    expect(res?.status).toBe(404);
    expect(await res?.text()).toBe("Not found");
  });

  test("requires a browser session for legacy file-serving paths", async () => {
    const req = new Request("http://local.test/api/files/missing/example.txt");

    const res = await handleFilesRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });
});
