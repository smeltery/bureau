import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("question routes enforce recipients, agent ownership, revisions and durable reply acceptance", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-questions-http-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect } from "bun:test";
      import { handleAgentsRequest } from "./server/http/agents.ts";
      import { setupPrivilegedFixture, TARGET_AGENT, OPERATOR_AGENT } from "./server/http/__tests__/privileged-agent-fixture.ts";
      import { agents } from "./server/agents/state.ts";
      import { mintAgentToken } from "./server/agents/tokens.ts";
      import { updateUserById } from "./server/users.ts";
      const fixture = setupPrivilegedFixture();
      const target = agents.get(TARGET_AGENT);
      target.info.state = "thinking"; target.sessionId = "question-session";
      const token = mintAgentToken(TARGET_AGENT, fixture.manager.id, false);
      const auth = user => ({ kind: "ok", session: { userId: user.id, role: user.role } });
      async function request(path, method = "GET", body, bearer, session) {
        const req = new Request("http://localhost" + path, { method, headers: { ...(bearer ? { Authorization: "Bearer " + bearer } : {}), "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return handleAgentsRequest(req, new URL(req.url), session);
      }
      const base = "/api/agents/" + TARGET_AGENT + "/questions";
      const payload = { prompt: "Pick a color", options: ["Blue", "Green"], recommended: "Blue" };
      expect((await request(base, "POST", payload, fixture.privilegedToken)).status).toBe(403);
      expect((await request(base, "POST", { ...payload, member: "missing" }, token)).status).toBe(422);
      expect((await request(base, "POST", { ...payload, member: fixture.ownerManager.name }, token)).status).toBe(201);
      const created = await request(base, "POST", payload, token);
      expect(created.status).toBe(201);
      const question = await created.json(), memberPath = "/api/questions/" + question.id;
      expect((await request("/api/questions", "GET", undefined, undefined, { kind: "loopback" })).status).toBe(401);
      expect((await request(memberPath, "GET", undefined, undefined, auth(fixture.ownerManager))).status).toBe(404);
      expect((await request(memberPath, "GET", undefined, undefined, auth(fixture.manager))).status).toBe(200);
      expect((await request(memberPath + "/answer", "POST", { revision: 2, text: "Green" }, undefined, auth(fixture.manager))).status).toBe(409);
      const accepted = await request(memberPath + "/answer", "POST", { revision: 1, text: "Green" }, undefined, auth(fixture.manager));
      expect((await accepted.json()).status).toBe("delivered");
      expect(target.messageQueue).toHaveLength(1);
      expect(target.messageQueue[0].text).toContain("Pick a color");
      expect(target.messageQueue[0].sender.username).toBe(fixture.manager.name);
      await request(memberPath + "/answer", "POST", { revision: 1, text: "Green" }, undefined, auth(fixture.manager));
      expect(target.messageQueue).toHaveLength(1);
      expect((await request(base + "/" + question.id, "DELETE", { revision: 1 }, token)).status).toBe(409);
      const stale = await (await request(base, "POST", { prompt: "Old conversation?" }, token)).json();
      target.sessionId = "new-session";
      const refused = await request("/api/questions/" + stale.id + "/answer", "POST", { revision: 1, text: "yes" }, undefined, auth(fixture.manager));
      expect((await refused.json()).status).toBe("failed");
      expect(target.messageQueue).toHaveLength(1);
      const racing = await (await request(base, "POST", { prompt: "Still accessible?" }, token)).json();
      const pending = request("/api/questions/" + racing.id + "/answer", "POST", { revision: 1, text: "yes" }, undefined, auth(fixture.manager));
      updateUserById(fixture.manager.id, { allowedRooms: [] });
      expect((await pending).status).toBe(404);
      expect(target.messageQueue).toHaveLength(1);
      expect((await request(memberPath, "GET", undefined, undefined, auth(fixture.manager))).status).toBe(404);
      expect((await (await request("/api/questions", "GET", undefined, undefined, auth(fixture.manager))).json()).questions).toEqual([]);
      process.exit(0);
    `,
      ],
      { env: { ...process.env, BUREAU_HOME: root }, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
