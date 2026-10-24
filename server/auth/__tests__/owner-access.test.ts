import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function isolated(script: string) {
  const home = mkdtempSync(join(tmpdir(), "bureau-owner-access-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect, spyOn } from "bun:test";
      import { claimUserByName, getUserById, updateUser, deleteUser, wouldDeleteLeaveNoOwner } from "./server/users.ts";
      import { createSessionForUser } from "./server/auth/session-creation.ts";
      import { sessionStore, persistSessions } from "./server/auth/store.ts";
      import { logoutBySessionHash, revokeSessionByPrefix, revokeActiveSessionByPrefixForUserId } from "./server/auth/session-lifecycle.ts";
      const a = claimUserByName("Owner A", { role: "owner" });
      const b = claimUserByName("Owner B", { role: "owner" });
      function signIn(user) {
        const session = createSessionForUser(user.id, null);
        sessionStore().set(session.sessionHash, session.session);
        persistSessions();
        return session;
      }
      ${script}
    `,
      ],
      { env: { ...process.env, BUREAU_HOME: home }, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("concurrent logout and revoke preserve one signed-in owner", () => {
  isolated(`
    const first = signIn(a);
    const second = signIn(b);
    const results = await Promise.all([
      logoutBySessionHash(first.sessionHash),
      revokeSessionByPrefix(second.session.sessionPrefix),
    ]);
    expect(results).toEqual(["ok", "would_strand_office"]);
    expect(sessionStore().has(first.sessionHash)).toBe(false);
    expect(sessionStore().has(second.sessionHash)).toBe(true);
  `);
});

test("member-scoped revocation does not reveal another owner's session", () => {
  isolated(`
    const session = signIn(a);
    expect(await revokeActiveSessionByPrefixForUserId(session.session.sessionPrefix, b.id)).toBe("not_found");
    expect(await revokeActiveSessionByPrefixForUserId(session.session.sessionPrefix, a.id)).toBe("would_strand_office");
    expect(sessionStore().has(session.sessionHash)).toBe(true);
  `);
});

test("expired owner sessions cannot make the last active session removable", () => {
  isolated(`
    const first = signIn(a);
    const second = signIn(b);
    second.session.absoluteExpiresAt = Date.now() - 1;
    expect(await logoutBySessionHash(first.sessionHash)).toBe("would_strand_office");
    expect(await logoutBySessionHash(second.sessionHash)).toBe("ok");
    expect(await logoutBySessionHash("missing")).toBe("not_found");
  `);
});

test("demotion and deletion require another signed-in owner", () => {
  isolated(`
    signIn(a);
    expect(wouldDeleteLeaveNoOwner(a.id)).toBe(true);
    expect(updateUser(a, a.id, { role: "member" }, [])).toBeNull();
    expect(deleteUser(b, a.id)).toBe(false);
    expect(getUserById(a.id).role).toBe("owner");
    signIn(b);
    expect(updateUser(a, a.id, { role: "member" }, []).role).toBe("member");
    expect(updateUser(b, b.id, { role: "member" }, [])).toBeNull();
  `);
});

test("a pending logout rechecks after synchronous owner demotion", () => {
  isolated(`
    signIn(a);
    const second = signIn(b);
    const logout = logoutBySessionHash(second.sessionHash);
    expect(updateUser(a, a.id, { role: "member" }, []).role).toBe("member");
    expect(await logout).toBe("would_strand_office");
    expect(sessionStore().has(second.sessionHash)).toBe(true);
  `);
});

test("HTTP logout refuses lockout without clearing browser cookies", () => {
  isolated(`
    const { handleLogout } = await import("./server/auth/auth-routes.ts");
    const { COOKIE_NAME } = await import("./server/auth/http-env.ts");
    const session = signIn(a);
    const response = await handleLogout(new Request("http://localhost:4000/logout", {
      method: "POST", headers: { Origin: "http://localhost:4000", Cookie: COOKIE_NAME + "=" + session.rawSessionId },
    }), null);
    expect(response.status).toBe(409);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(sessionStore().has(session.sessionHash)).toBe(true);
  `);
});

test("WebSocket logout reports a refusal and keeps session context", () => {
  isolated(`
    const { handleAccessCommand } = await import("./server/ws/access-commands.ts");
    const { bindWsUser, setWsSessionPrefix } = await import("./server/user-sockets.ts");
    const session = signIn(a);
    const sent = [];
    const ws = { send: data => sent.push(JSON.parse(data)) };
    bindWsUser(ws, a);
    setWsSessionPrefix(ws, session.session.sessionPrefix);
    await handleAccessCommand({ type: "logout" }, ws);
    expect(sent.map(row => row.type)).toEqual(["revoke_blocked"]);
    expect(sent[0].reasonCode).toBe("last_owner_logout");
    expect(sessionStore().has(session.sessionHash)).toBe(true);
  `);
});

test("HTTP deletion rechecks owner access after agent reassignment", () => {
  isolated(`
    const manager = await import("./server/agent-manager.ts");
    const { deleteUserForApi } = await import("./server/http/access-adapters.ts");
    const first = signIn(a);
    signIn(b);
    const reassign = spyOn(manager, "reassignAgentsOwnedBy").mockImplementation(async () => {
      expect(await logoutBySessionHash(first.sessionHash)).toBe("ok");
    });
    try {
      const result = await deleteUserForApi(a.id, "owner", b.name);
      expect(result.ok).toBe(false);
      expect(result.status).toBe(409);
      expect(getUserById(b.id).role).toBe("owner");
    } finally { reassign.mockRestore(); }
  `);
});
