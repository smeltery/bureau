import { expect, test } from "bun:test";
import { handleAuditRequest } from "./http.ts";
import { claimUserByName, deleteUserById } from "../users.ts";
import { mintAgentToken, revokeAgentToken } from "../agents/tokens.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";

test("audit reads require an owner identity, including privileged agent callers", async () => {
  const owner = claimUserByName(`Audit owner ${crypto.randomUUID()}`, { role: "owner", allowedRooms: [] });
  const agent = `audit-agent-${crypto.randomUUID()}`;
  const url = new URL("http://localhost/api/audit-log");
  const auth: AuthResult = {
    kind: "ok",
    session: { userId: owner.id, username: owner.name, role: "owner", sessionIdHash: "h", sessionPrefix: "s", needsRolling: false, absoluteExpiresAt: Date.now() + 10000 },
  };
  try {
    expect((await handleAuditRequest(new Request(url), url, auth))?.status).toBe(200);
    expect((await handleAuditRequest(new Request(url), url, { ...auth, session: { ...auth.session, role: "member" } }))?.status).toBe(403);
    expect((await handleAuditRequest(new Request(url), url, { kind: "loopback" }))?.status).toBe(403);
    const token = mintAgentToken(agent, owner.id, false);
    expect((await handleAuditRequest(new Request(url, { headers: { Authorization: `Bearer ${token}` } }), url, auth))?.status).toBe(403);
    const privileged = mintAgentToken(agent, owner.id, true);
    expect((await handleAuditRequest(new Request(url, { headers: { Authorization: `Bearer ${privileged}` } }), url, { kind: "loopback" }))?.status).toBe(200);
  } finally {
    revokeAgentToken(agent);
    deleteUserById(owner.id);
  }
});

test("request audit metadata excludes path values, queries and body secrets", async () => {
  const { auditHttpRequest } = await import("./http.ts");
  const { atomicWriteFileSync, BUREAU_DIR } = await import("../persistence/paths.ts");
  const { readAuditPage } = await import("./store.ts");
  const { join } = await import("node:path");
  const { rmSync } = await import("node:fs");
  const name = `audit-route-${crypto.randomUUID()}.json`;
  const path = join(BUREAU_DIR, name);
  try {
    const req = new Request("http://localhost/api/tasks/private-name-123?token=query-secret", { method: "POST", body: "body-secret" });
    auditHttpRequest(req, () => atomicWriteFileSync(path, JSON.stringify({ title: "content-secret" })));
    const entry = readAuditPage({ operation: "POST /api/tasks/:id" }).entries.find((row) => row.target === name)!;
    expect(entry).toBeDefined();
    expect(JSON.stringify(entry)).not.toMatch(/private-name|query-secret|body-secret|content-secret/);
  } finally {
    rmSync(path, { force: true });
  }
});
