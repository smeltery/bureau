import { describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleSystemRequest } from "../system.ts";

const auth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash-1",
    sessionPrefix: "sess",
    userId: "owner-1",
    username: "Owner",
    role: "owner",
    needsRolling: false,
  },
};

const backupStatus = {
  stateDir: "/state",
  backupDir: "/backups",
  retention: 7,
  lastBackupAt: 123,
  lastBackupOk: true,
  lastBackupError: null,
  lastBackupFile: "backup.tar.gz",
  running: true,
};

const versionInfo = {
  version: "v2026.7.22",
  commit: "abc123",
  release: "v2026.7.22",
};

const deps = {
  getBackupStatus: () => backupStatus,
  getVersion: () => versionInfo,
};

describe("handleSystemRequest", () => {
  test("returns null for unrelated api routes", () => {
    const req = new Request("http://local.test/api/tasks");

    expect(handleSystemRequest(req, new URL(req.url), auth, deps)).toBeNull();
  });

  test("requires a browser session for backup status", async () => {
    const req = new Request("http://local.test/api/backup/status");

    const res = handleSystemRequest(req, new URL(req.url), { kind: "loopback" }, deps);

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });

  test("returns normalized backup status", async () => {
    const req = new Request("http://local.test/api/backup/status");

    const res = handleSystemRequest(req, new URL(req.url), auth, deps);

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual({
      lastRunAt: 123,
      ok: true,
      error: null,
      retention: 7,
      destDir: "/backups",
    });
  });

  test("returns version info for browser sessions", async () => {
    const req = new Request("http://local.test/api/version");

    const res = handleSystemRequest(req, new URL(req.url), auth, deps);

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual(versionInfo);
  });

  test("returns version info for loopback agents", async () => {
    const req = new Request("http://local.test/api/version");

    const res = handleSystemRequest(req, new URL(req.url), { kind: "loopback" }, deps);

    expect(res?.status).toBe(200);
    expect(await res?.json()).toEqual(versionInfo);
  });

  test("requires auth for version info", async () => {
    const req = new Request("http://local.test/api/version");

    const res = handleSystemRequest(req, new URL(req.url), undefined, deps);

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });
});
