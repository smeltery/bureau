import { describe, expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { LOGS_DIR } from "../../persistence/paths.ts";
import { claimUserByName } from "../../users.ts";
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

  test("refuses legacy file routes for an agent outside the member's rooms", async () => {
    const member = claimUserByName(`files-member-${Date.now()}`, { role: "member", allowedRooms: [] });
    const memberAuth: AuthResult = { kind: "ok", session: { ...auth.session, userId: member.id, username: member.name, role: "member" } };
    for (const path of ["/api/files/gone-agent/a.txt", "/api/images/gone-agent/a.png"]) {
      const req = new Request(`http://local.test${path}`);
      const res = await handleFilesRequest(req, new URL(req.url), memberAuth);
      expect(res?.status).toBe(403);
    }
    const upload = new Request("http://local.test/api/upload/gone-agent", { method: "POST" });
    expect((await handleFilesRequest(upload, new URL(upload.url), memberAuth))?.status).toBe(403);
  });

  test("serves active files sandboxed and every file private and nosniff", async () => {
    const agentId = `files-test-${Date.now()}`;
    mkdirSync(join(LOGS_DIR, agentId, "files"), { recursive: true });
    for (const name of ["page.html", "logo.svg", "doc.pdf"]) writeFileSync(join(LOGS_DIR, agentId, "files", name), "x");

    const get = async (name: string) => {
      const req = new Request(`http://local.test/api/files/${agentId}/${name}`);
      return (await handleFilesRequest(req, new URL(req.url), auth))!;
    };
    const html = await get("page.html");
    const svg = await get("logo.svg");
    const pdf = await get("doc.pdf");

    expect(html.headers.get("Content-Security-Policy")).toEndWith("; sandbox allow-scripts");
    expect(svg.headers.get("Content-Type")).toBe("image/svg+xml");
    expect(svg.headers.get("Content-Security-Policy")).toEndWith("; sandbox allow-scripts");
    expect(pdf.headers.get("Content-Security-Policy")).toBeNull();
    for (const res of [html, svg, pdf]) {
      expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
    }
  });

  test("requires a browser session for legacy file-serving paths", async () => {
    const req = new Request("http://local.test/api/files/missing/example.txt");

    const res = await handleFilesRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });
});
