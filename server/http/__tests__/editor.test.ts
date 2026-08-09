import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleEditorRequest, type EditorHttpDeps } from "../editor.ts";

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

const deps: EditorHttpDeps = {
  verifyConnection: () => true,
  watchFile: () => {},
  closeWatch: () => {},
};

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://local.test${path}`, {
    method: "GET",
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

describe("handleEditorRequest", () => {
  test("returns null for unrelated api routes", async () => {
    const req = request("/api/tasks");

    await expect(handleEditorRequest(req, new URL(req.url), auth, deps)).resolves.toBeNull();
  });

  test("routes editor file reads under /api/agents", async () => {
    const req = request("/api/agents/missing/file?path=README.md", {
      headers: { "X-Bureau-Connection-Id": "conn-1" },
    });

    const res = await handleEditorRequest(req, new URL(req.url), auth, deps);

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "agent not found", code: "not_found" });
  });

  test("routes editor file saves under /api/agents", async () => {
    const req = request("/api/agents/missing/file", {
      method: "PUT",
      body: JSON.stringify({ path: "README.md", content: "", expectedMtime: 0 }),
    });

    const res = await handleEditorRequest(req, new URL(req.url), auth, deps);

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "agent not found", code: "not_found" });
  });

  test("routes editor watch closes under /api/agents", async () => {
    const req = request("/api/agents/missing/file/watch?path=README.md", {
      method: "DELETE",
      headers: { "X-Bureau-Connection-Id": "conn-1" },
    });

    const res = await handleEditorRequest(req, new URL(req.url), auth, deps);

    expect(res?.status).toBe(404);
    expect(await res?.json()).toEqual({ error: "agent not found", code: "not_found" });
  });
});
