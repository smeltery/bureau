import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("localhost browser requests retain the member identity for inbox and storage", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-local-browser-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect } from "bun:test";
      import { createFetchHandler } from "./server/http/router.ts";
      import { claimUserByName } from "./server/users.ts";
      import { createSessionForUser } from "./server/auth/session-creation.ts";
      import { sessionStore } from "./server/auth/store.ts";
      import { setHasOwnerProvider, freezeBootState } from "./server/auth/http-env.ts";
      import { freezeAppHostDomain } from "./server/apps/domain.ts";
      setHasOwnerProvider(() => true); freezeBootState({ externalAccess: false }); freezeAppHostDomain();
      const owner = claimUserByName("Owner", { role: "owner" });
      const session = createSessionForUser(owner.id, "test"); sessionStore().set(session.sessionHash, session.session);
      const server = { requestIP: () => ({ address: "127.0.0.1" }), timeout: () => {} };
      const fetch = createFetchHandler();
      for (const [path, method, body] of [["/api/questions", "GET"], ["/api/backup/settings", "GET"], ["/api/storage/usage", "GET"], ["/api/storage/compress", "POST", { olderThanDays: 30 }]]) {
        const request = cookie => new Request("http://localhost" + path, { method, headers: { Cookie: cookie ? "bureau_session=" + session.rawSessionId : "", "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
        expect((await fetch(request(true), server)).status).toBe(200);
        expect((await fetch(request(false), server)).status).toBe(401);
      }
      process.exit(0);
    `,
      ],
      { env: { ...process.env, BUREAU_HOME: root, BUREAU_BACKUP_DIR: join(root, "..", "unused-test-backup") }, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
