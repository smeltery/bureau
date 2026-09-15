import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { createMembersChatStore, type MembersChatStore } from "../../members-chat/store.ts";
import { handleMembersChatRequest } from "../members-chat.ts";

const ownerAuth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash",
    sessionPrefix: "sess",
    userId: "owner-1",
    username: "Owner",
    role: "owner",
    needsRolling: false,
    absoluteExpiresAt: Date.now() + 86_400_000,
  },
};

const memberAuth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash2",
    sessionPrefix: "sess2",
    userId: "member-1",
    username: "Member",
    role: "member",
    needsRolling: false,
    absoluteExpiresAt: Date.now() + 86_400_000,
  },
};

const apiAuth: AuthResult = {
  kind: "api",
  token: {
    userId: "owner-1",
    username: "Owner",
    role: "owner",
    tokenId: "tok-1",
    tokenName: "ci",
  },
};

const loopbackAuth: AuthResult = { kind: "loopback" };

let dir: string;
let store: MembersChatStore;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "bureau-members-chat-http-"));
  store = createMembersChatStore(dir, { now: () => Date.UTC(2026, 8, 15, 12, 0, 0) });
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

function request(path: string, init: RequestInit = {}): Request {
  return new Request(`http://local.test${path}`, {
    ...init,
    headers: {
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

async function handle(path: string, auth: AuthResult | undefined, init: RequestInit = {}) {
  const req = request(path, init);
  return handleMembersChatRequest(req, new URL(req.url), auth, store);
}

describe("handleMembersChatRequest ACL", () => {
  test("returns null for unrelated routes", async () => {
    expect(await handle("/api/tasks", ownerAuth)).toBeNull();
  });

  test("rejects API tokens", async () => {
    const res = await handle("/api/members-chat", apiAuth);
    expect(res?.status).toBe(401);
    expect(await res?.json()).toMatchObject({ code: "browser_session_required" });
  });

  test("rejects loopback callers", async () => {
    const res = await handle("/api/members-chat", loopbackAuth);
    expect(res?.status).toBe(401);
  });

  test("rejects missing auth", async () => {
    const res = await handle("/api/members-chat", undefined);
    expect(res?.status).toBe(401);
  });

  test("lets a cookie session list and post", async () => {
    const posted = await handle("/api/members-chat", memberAuth, {
      method: "POST",
      body: JSON.stringify({ text: "hello team" }),
    });
    expect(posted?.status).toBe(201);
    const message = (await posted!.json()) as { id: string; content: string; userId: string };
    expect(message.content).toBe("hello team");
    expect(message.userId).toBe("member-1");

    const page = await handle("/api/members-chat", ownerAuth);
    expect(page?.status).toBe(200);
    const body = (await page!.json()) as { messages: { id: string }[] };
    expect(body.messages.map((m) => m.id)).toEqual([message.id]);
  });

  test("owners can pin; members cannot", async () => {
    const posted = await handle("/api/members-chat", memberAuth, {
      method: "POST",
      body: JSON.stringify({ text: "pin me" }),
    });
    const { id } = (await posted!.json()) as { id: string };

    const denied = await handle(`/api/members-chat/${id}/pin`, memberAuth, {
      method: "PUT",
      body: JSON.stringify({ active: true }),
    });
    expect(denied?.status).toBe(403);

    const pinned = await handle(`/api/members-chat/${id}/pin`, ownerAuth, {
      method: "PUT",
      body: JSON.stringify({ active: true }),
    });
    expect(pinned?.status).toBe(200);
    expect(((await pinned!.json()) as { pinnedAt?: number }).pinnedAt).toBeDefined();
  });

  test("authors and owners can delete; other members cannot", async () => {
    const posted = await handle("/api/members-chat", memberAuth, {
      method: "POST",
      body: JSON.stringify({ text: "bye" }),
    });
    const { id } = (await posted!.json()) as { id: string };

    const other: AuthResult = {
      kind: "ok",
      session: { ...memberAuth.session, userId: "member-2", username: "Other" },
    };
    expect((await handle(`/api/members-chat/${id}`, other, { method: "DELETE" }))?.status).toBe(403);

    const deleted = await handle(`/api/members-chat/${id}`, memberAuth, { method: "DELETE" });
    expect(deleted?.status).toBe(204);
    expect(store.get(id)).toBeNull();
  });
});
