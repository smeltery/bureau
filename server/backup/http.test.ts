import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("backup settings require a current browser owner, including after reading the body", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-backup-http-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect } from "bun:test";
      import { handleStorageRequest } from "./server/http/storage.ts";
      import { claimUserByName, updateUserById } from "./server/users.ts";
      import { readBackupSettings } from "./server/backup/settings.ts";
      const owner = claimUserByName("Owner", { role: "owner" });
      const member = claimUserByName("Member", { role: "member" });
      const auth = user => ({ kind: "ok", session: { userId: user.id, role: user.role } });
      const url = new URL("http://localhost/api/backup/settings");
      const request = (method = "GET", body) => new Request(url, { method, ...(body !== undefined ? { body: JSON.stringify(body), headers: { "Content-Type": "application/json" } } : {}) });
      const handle = (req, session) => handleStorageRequest(req, url, session);
      for (const session of [undefined, { kind: "loopback" }, { kind: "api", token: {} }]) expect((await handle(request(), session)).status).toBe(401);
      expect((await handle(request(), auth(member))).status).toBe(403);
      expect((await handle(request(), auth(owner))).status).toBe(200);
      expect((await handle(request("DELETE"), auth(owner))).status).toBe(405);
      expect((await handle(request("PATCH", { retention: 4 }), auth(owner))).status).toBe(200);
      expect(readBackupSettings().settings.retention).toBe(4);
      expect((await handle(request("PATCH", { intervalHours: 0 }), auth(owner))).status).toBe(400);
      expect((await handle(new Request(url, { method: "PATCH", body: "{" }), auth(owner))).status).toBe(400);
      const pending = handle(request("PATCH", { retention: 2 }), auth(owner));
      updateUserById(owner.id, { role: "member" });
      expect((await pending).status).toBe(403);
      expect(readBackupSettings().settings.retention).toBe(4);
      expect((await handle(request(), auth({ ...owner, role: "owner" }))).status).toBe(403);
      process.exit(0);
    `,
      ],
      { env: { ...process.env, BUREAU_HOME: join(root, "state"), BUREAU_BACKUP_DIR: "" }, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
