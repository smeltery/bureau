// The owner-login recovery socket, which had no test.
//
// This is the account-recovery path: it mints a 15-minute owner login URL for
// somebody who has lost their only session. There is no token, no cookie and no
// password in front of it — FILESYSTEM PERMISSIONS ARE THE AUTH BOUNDARY, which
// is defensible only because any UID that can connect to the socket can already
// read the auth files in ~/.bureau. That argument holds only while the socket is
// really mode 0600 and the route really refuses everything except an owner, so
// both are asserted here rather than trusted.
//
// Driven over a real Unix socket instead of by exporting the handler, because
// the mode of the created inode is half of what is being tested and a direct
// call would not create one.

import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, rmSync, statSync, unlinkSync, writeFileSync } from "fs";
import { ADMIN_SOCKET_FILE } from "../../persistence/paths.ts";
import { claimUserByName, deleteUserById } from "../../users.ts";
import { startAdminSocket } from "../admin-socket.ts";

const OWNER_LOGIN_TTL_MS = 15 * 60 * 1000;
const createdUserIds: string[] = [];

/** Names are unique per run so this file never depends on another's fixtures. */
const ownerName = `Recovery Owner ${crypto.randomUUID()}`;
const memberName = `Recovery Member ${crypto.randomUUID()}`;

beforeAll(() => {
  // An owner must exist for the route to get past its pre-claim refusal, and a
  // member is needed to prove recovery is owner-only. Both are ours.
  createdUserIds.push(claimUserByName(ownerName, { role: "owner" }).id);
  createdUserIds.push(claimUserByName(memberName, { role: "member" }).id);
});

afterAll(() => {
  for (const id of createdUserIds.splice(0)) deleteUserById(id);
});

function clearSocketPath() {
  try {
    if (existsSync(ADMIN_SOCKET_FILE)) unlinkSync(ADMIN_SOCKET_FILE);
  } catch {
    rmSync(ADMIN_SOCKET_FILE, { force: true });
  }
}

/** Speak to the socket the way the CLI does. */
async function admin(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`http://localhost${path}`, { unix: ADMIN_SOCKET_FILE, ...init } as RequestInit);
}

function postName(name: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) };
}

describe("startAdminSocket", () => {
  afterEach(clearSocketPath);

  test("refuses to overwrite a regular file sitting at its path", () => {
    // The operator (or a bad deployment) put something else there. Unlinking it
    // blind could destroy data, so the admin CLI is given up instead.
    clearSocketPath();
    writeFileSync(ADMIN_SOCKET_FILE, "not-a-socket, possibly precious");

    startAdminSocket();

    expect(statSync(ADMIN_SOCKET_FILE).isSocket()).toBe(false);
    expect(Bun.file(ADMIN_SOCKET_FILE).text()).resolves.toBe("not-a-socket, possibly precious");
  });

  test("binds mode 0600, which is the whole auth boundary", () => {
    clearSocketPath();

    startAdminSocket();

    const stat = statSync(ADMIN_SOCKET_FILE);
    expect(stat.isSocket()).toBe(true);
    // Not group- or world-connectable: on a multi-user box this is what keeps
    // other local users from minting an owner session.
    expect(stat.mode & 0o777).toBe(0o600);
  });

  test("replaces a stale socket left by a previous process", () => {
    clearSocketPath();
    startAdminSocket();
    const first = statSync(ADMIN_SOCKET_FILE).ino;

    // A restart must not be wedged by its own leftover inode.
    startAdminSocket();

    expect(statSync(ADMIN_SOCKET_FILE).isSocket()).toBe(true);
    expect(statSync(ADMIN_SOCKET_FILE).ino).not.toBe(first);
  });
});

describe("POST /admin/owner-login", () => {
  beforeAll(() => {
    clearSocketPath();
    startAdminSocket();
  });

  test("serves exactly one route and one method", async () => {
    expect((await admin("/admin/owner-login", { method: "GET" })).status).toBe(404);
    expect((await admin("/admin/anything-else", postName(ownerName))).status).toBe(404);
    expect((await admin("/", postName(ownerName))).status).toBe(404);
  });

  test("a malformed or nameless body is rejected before any lookup", async () => {
    const badJson = await admin("/admin/owner-login", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{not json" });
    expect(badJson.status).toBe(400);
    expect((await badJson.json()).error).toContain("invalid JSON");

    for (const name of ["", "   ", 42, null]) {
      const res = await admin("/admin/owner-login", postName(name));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("--name is required");
    }
  });

  test("a name nobody in the office holds gets 404, not a URL", async () => {
    const res = await admin("/admin/owner-login", postName(`Nobody ${crypto.randomUUID()}`));

    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.url).toBeUndefined();
  });

  test("a MEMBER cannot recover an owner session — the authority boundary", async () => {
    // Recovery mints an OWNER invite. If a member could drive it, any invited
    // user who reached the socket would be one call from owning the office.
    const res = await admin("/admin/owner-login", postName(memberName));

    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(body.error).toContain("is a member, not an owner");
    expect(body.url).toBeUndefined();
  });

  test("an owner gets a login URL that expires in 15 minutes", async () => {
    const before = Date.now();
    const res = await admin("/admin/owner-login", postName(ownerName));

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.url).toContain("/i/");
    expect(body.ttlMs).toBe(OWNER_LOGIN_TTL_MS);
    // Short-lived on purpose: shell access hands straight off to a browser, so a
    // URL forgotten on a shared screen stops working quickly.
    expect(body.expiresAt).toBeGreaterThanOrEqual(before + OWNER_LOGIN_TTL_MS - 5_000);
    expect(body.expiresAt).toBeLessThanOrEqual(Date.now() + OWNER_LOGIN_TTL_MS + 5_000);
  });

  test("the name is matched leniently on surrounding whitespace, not on identity", async () => {
    expect((await admin("/admin/owner-login", postName(`  ${ownerName}  `))).status).toBe(200);
    expect((await admin("/admin/owner-login", postName(`${ownerName} extra`))).status).toBe(404);
  });
});
