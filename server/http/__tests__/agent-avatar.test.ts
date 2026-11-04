import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { agents } from "../../agents/state.ts";
import { agentAvatarSvg } from "../agent-avatar.ts";
import { handleAgentsRequest } from "../agents.ts";
import { bearerRequest, HIDDEN_AGENT, PLAIN_AGENT, setupPrivilegedFixture, TARGET_AGENT, teardownPrivilegedFixture, type PrivilegedFixture } from "./privileged-agent-fixture.ts";

let fixture: PrivilegedFixture;
beforeAll(() => {
  fixture = setupPrivilegedFixture();
});
afterAll(() => teardownPrivilegedFixture(fixture));

const memberAuth = (): AuthResult => ({
  kind: "ok",
  session: { sessionIdHash: "hash", sessionPrefix: "sess", userId: fixture.manager.id, username: "member", role: "member", needsRolling: false, absoluteExpiresAt: Date.now() + 86_400_000 },
});

const avatar = (agentId: string, init: RequestInit = {}, auth?: AuthResult) => {
  const req = new Request(`http://local.test/api/agents/${agentId}/avatar.svg`, init);
  return handleAgentsRequest(req, new URL(req.url), auth);
};

describe("GET /api/agents/:id/avatar.svg", () => {
  test("serves the portrait as a standalone, script-free SVG with revalidation", async () => {
    const res = (await avatar(TARGET_AGENT, {}, memberAuth()))!;
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("image/svg+xml; charset=utf-8");
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(res.headers.get("Content-Security-Policy")).toContain("default-src 'none'");
    const body = await res.text();
    expect(body.startsWith('<svg xmlns="http://www.w3.org/2000/svg" ')).toBe(true);
    expect(body).not.toContain("<script");

    const etag = res.headers.get("ETag")!;
    const cached = (await avatar(TARGET_AGENT, { headers: { "If-None-Match": etag } }, memberAuth()))!;
    expect(cached.status).toBe(304);
    expect(cached.headers.get("ETag")).toBe(etag);
  });

  test("a new outfit changes the image and its ETag", async () => {
    const before = (await avatar(TARGET_AGENT, {}, memberAuth()))!.headers.get("ETag");
    const info = agents.get(TARGET_AGENT)!.info;
    const original = info.outfit;
    info.outfit = { ...original, hair: "#FF0000" };
    try {
      const after = (await avatar(TARGET_AGENT, {}, memberAuth()))!;
      expect(after.headers.get("ETag")).not.toBe(before);
      expect(await after.text()).toContain("#FF0000");
    } finally {
      info.outfit = original;
    }
  });

  test("outfit strings are escaped, never markup", () => {
    const svg = agentAvatarSvg({ hat: "none", color: '"><script>alert(1)</script>', hair: "#000", hairStyle: "short", skin: "#000", beard: "none", accessory: null });
    expect(svg).not.toContain("<script>");
  });

  test("only callers who can see the agent's room get the image", async () => {
    expect((await avatar(TARGET_AGENT))!.status).toBe(401);
    expect((await avatar(HIDDEN_AGENT, {}, memberAuth()))!.status).toBe(403);
    expect((await avatar("no-such-agent", {}, memberAuth()))!.status).toBe(404);
    const ownBearer = bearerRequest(`/api/agents/${PLAIN_AGENT}/avatar.svg`, fixture.plainToken, { method: "GET" });
    expect((await handleAgentsRequest(ownBearer, new URL(ownBearer.url)))!.status).toBe(200);
  });
});
