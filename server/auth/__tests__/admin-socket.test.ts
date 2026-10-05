// The owner-login recovery socket, which had no test.
//
// This is the account-recovery path: it mints a 15-minute owner login URL for
// somebody who has lost their only session. There is no token, no cookie and no
// password in front of it; the socket checks the connecting peer UID and refuses
// the Bureau server UID because agents and terminals commonly share it.
//
// Driven over a real Unix socket instead of by exporting the handler, because
// the mode of the created inode is half of what is being tested and a direct
// call would not create one.

import { afterAll, afterEach, beforeAll, describe, expect, spyOn, test } from "bun:test";
import { existsSync, mkdtempSync, rmSync, statSync, unlinkSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { claimUserByName, deleteUserById } from "../../users.ts";
import { resolveAllowedPeerUids, startAdminSocket } from "../admin-socket.ts";
import { ownerLoginCommand } from "../admin-cli.ts";

const OWNER_LOGIN_TTL_MS = 15 * 60 * 1000;
const createdUserIds: string[] = [];

/** Names are unique per run so this file never depends on another's fixtures. */
const ownerName = `Recovery Owner ${crypto.randomUUID()}`;
const memberName = `Recovery Member ${crypto.randomUUID()}`;
let socketPath: string;
let socketDir: string | null = null;
let adminServer: { stop(): void } | null = null;

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
  adminServer?.stop();
  adminServer = null;
  try {
    if (existsSync(socketPath)) unlinkSync(socketPath);
  } catch {
    rmSync(socketPath, { force: true });
  }
}

function resetSocketPath() {
  if (socketDir) rmSync(socketDir, { recursive: true, force: true });
  socketDir = mkdtempSync(join(tmpdir(), "bureau-admin-sock-"));
  socketPath = join(socketDir, "admin.sock");
}

/** Speak to the socket the way the CLI does. */
async function admin(path: string, init: RequestInit = {}): Promise<Response> {
  return await fetch(`http://localhost${path}`, { unix: socketPath, ...init } as RequestInit);
}

function postName(name: unknown): RequestInit {
  return { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) };
}

describe("startAdminSocket", () => {
  beforeAll(resetSocketPath);
  afterEach(() => {
    clearSocketPath();
    resetSocketPath();
  });
  afterAll(() => {
    clearSocketPath();
    if (socketDir) rmSync(socketDir, { recursive: true, force: true });
  });

  test("refuses to overwrite a regular file sitting at its path", () => {
    // The operator (or a bad deployment) put something else there. Unlinking it
    // blind could destroy data, so the admin CLI is given up instead.
    clearSocketPath();
    writeFileSync(socketPath, "not-a-socket, possibly precious");

    adminServer = startAdminSocket({ socketPath });

    expect(adminServer).toBeNull();
    expect(statSync(socketPath).isSocket()).toBe(false);
    expect(Bun.file(socketPath).text()).resolves.toBe("not-a-socket, possibly precious");
  });

  test("binds mode 0600 when only root is allowed", () => {
    clearSocketPath();

    adminServer = startAdminSocket({ socketPath, readPeerUid: () => 0 });

    expect(adminServer).not.toBeNull();
    const stat = statSync(socketPath);
    expect(stat.isSocket()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o600);
  });

  test("replaces a stale socket left by a previous process", () => {
    clearSocketPath();
    adminServer = startAdminSocket({ socketPath, readPeerUid: () => 0 });
    const first = statSync(socketPath).ino;

    // A restart must not be wedged by its own leftover inode.
    adminServer = startAdminSocket({ socketPath, readPeerUid: () => 0 });

    expect(statSync(socketPath).isSocket()).toBe(true);
    expect(statSync(socketPath).ino).not.toBe(first);
  });
});

describe("POST /admin/owner-login", () => {
  beforeAll(() => {
    resetSocketPath();
    adminServer = startAdminSocket({ socketPath, readPeerUid: () => 0 });
  });
  afterAll(() => {
    clearSocketPath();
    if (socketDir) rmSync(socketDir, { recursive: true, force: true });
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

describe("admin socket peer authorization", () => {
  beforeAll(resetSocketPath);
  afterEach(() => {
    clearSocketPath();
    resetSocketPath();
  });
  afterAll(() => {
    clearSocketPath();
    if (socketDir) rmSync(socketDir, { recursive: true, force: true });
  });

  test("refuses the server uid as read from the kernel", async () => {
    adminServer = startAdminSocket({ socketPath });
    expect(adminServer).not.toBeNull();

    const res = await admin("/admin/owner-login", postName(ownerName));

    expect(res.status).toBe(403);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  });

  test("answers a configured recovery uid and lets it connect", async () => {
    const serverUid = process.getuid?.() ?? -1;
    const recoveryUid = serverUid + 1;
    adminServer = startAdminSocket({ socketPath, serverUid, recoveryUidSetting: String(recoveryUid), readPeerUid: () => recoveryUid });
    expect(adminServer).not.toBeNull();
    expect(statSync(socketPath).mode & 0o777).toBe(0o666);

    expect((await admin("/admin/owner-login", postName(ownerName))).status).toBe(200);
  });

  test("ignores a recovery uid matching the server uid", async () => {
    const serverUid = process.getuid?.() ?? -1;
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
      adminServer = startAdminSocket({ socketPath, serverUid, recoveryUidSetting: String(serverUid), readPeerUid: () => serverUid });
      expect(adminServer).not.toBeNull();
      expect(statSync(socketPath).mode & 0o777).toBe(0o600);
      expect((await admin("/admin/owner-login", postName(ownerName))).status).toBe(403);
      expect(errors.mock.calls.some((call) => String(call[0]).includes("BUREAU_RECOVERY_UID"))).toBe(true);
    } finally {
      errors.mockRestore();
    }
  });
});

describe("owner-login CLI", () => {
  test("prints a root curl command with shell-safe quoting", async () => {
    resetSocketPath();
    adminServer = startAdminSocket({ socketPath, readPeerUid: () => 0 });
    const command = ownerLoginCommand(ownerName, socketPath);
    expect(command.startsWith("sudo ")).toBe(true);
    const child = Bun.spawn(["bash", "-c", command.slice("sudo ".length)], { stdout: "pipe" });
    const body = JSON.parse(await new Response(child.stdout).text()) as { ok: boolean; url: string };
    expect(await child.exited).toBe(0);
    expect(body.ok).toBe(true);
    expect(body.url).toContain("/i/");
    clearSocketPath();
    if (socketDir) rmSync(socketDir, { recursive: true, force: true });
    socketDir = null;
  });
});

describe("resolveAllowedPeerUids", () => {
  test("allows root and a valid recovery uid", () => {
    expect([...resolveAllowedPeerUids(1000, undefined)]).toEqual([0]);
    expect([...resolveAllowedPeerUids(1000, " 1001 ")]).toEqual([0, 1001]);
  });

  test("drops malformed or same-uid recovery settings", () => {
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
      for (const setting of ["abc", "-1", "1e3", "1000"]) expect([...resolveAllowedPeerUids(1000, setting)]).toEqual([0]);
      expect(errors).toHaveBeenCalledTimes(4);
    } finally {
      errors.mockRestore();
    }
  });

  test("refuses root when the server itself runs as root", () => {
    const errors = spyOn(console, "error").mockImplementation(() => {});
    try {
      expect([...resolveAllowedPeerUids(0, undefined)]).toEqual([]);
      expect([...resolveAllowedPeerUids(0, "1001")]).toEqual([1001]);
    } finally {
      errors.mockRestore();
    }
  });
});
