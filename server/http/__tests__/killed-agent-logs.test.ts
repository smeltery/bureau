import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { rmSync } from "fs";
import { join } from "path";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { _testResetAgentTokens, mintAgentToken } from "../../agents/tokens.ts";
import { agents } from "../../agents/state.ts";
import { appendLog } from "../../persistence/logs/logs.ts";
import { loadAgentHistory, saveAgentHistory } from "../../persistence/config/agent-history.ts";
import { LOGS_DIR } from "../../persistence/paths.ts";
import { claimUserByName, deleteUserById } from "../../users.ts";
import { handleAgentsRequest } from "../agents.ts";

const AGENT_ID = "agent-killed-log-http";

beforeEach(() => {
  _testResetAgentTokens();
  agents.clear();
  cleanupKilledAgent();
});

afterEach(() => {
  _testResetAgentTokens();
  agents.clear();
  cleanupKilledAgent();
});

function cleanupKilledAgent() {
  rmSync(join(LOGS_DIR, AGENT_ID), { recursive: true, force: true });
  const history = loadAgentHistory();
  if (!history[AGENT_ID]) return;
  delete history[AGENT_ID];
  saveAgentHistory(history);
}

function installKilledAgentHistory(userId: string | null) {
  const history = loadAgentHistory();
  history[AGENT_ID] = {
    name: "Killed Log Agent",
    userId,
    lastRoomId: "room-1",
    lastRoomName: "Room 1",
    killedAt: Date.now(),
  };
  saveAgentHistory(history);
}

function appendKilledEntry(content: string) {
  appendLog(AGENT_ID, "session-one", {
    id: "entry-one",
    agentId: AGENT_ID,
    timestamp: 1000,
    kind: "text",
    content,
  });
}

function bearerRequest(token: string, query: string): Request {
  return new Request(`http://local.test/api/agents/${AGENT_ID}/logs?q=${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
}

describe("GET /api/agents/:id/logs for killed agents", () => {
  test("lets a killed agent's manager read retained logs", async () => {
    const manager = claimUserByName(`Killed Manager ${crypto.randomUUID()}`, { role: "member" });
    try {
      installKilledAgentHistory(manager.id);
      appendKilledEntry("retained killed transcript");
      const token = mintAgentToken("manager-live-agent", manager.id);

      const res = await handleAgentsRequest(bearerRequest(token, "retained"), new URL(`http://local.test/api/agents/${AGENT_ID}/logs?q=retained`));
      const body = await res?.json();

      expect(res?.status).toBe(200);
      expect(body.results.map((hit: { entryId: string }) => hit.entryId)).toEqual(["entry-one"]);
    } finally {
      deleteUserById(manager.id);
    }
  });

  test("lets owners read killed agent logs", async () => {
    const owner = claimUserByName(`Killed Owner ${crypto.randomUUID()}`, { role: "owner" });
    try {
      installKilledAgentHistory("other-user");
      appendKilledEntry("owner-visible killed transcript");
      const req = new Request(`http://local.test/api/agents/${AGENT_ID}/logs?q=owner-visible`);

      const res = await handleAgentsRequest(req, new URL(req.url), authFor(owner.id, owner.name, "owner"));
      const body = await res?.json();

      expect(res?.status).toBe(200);
      expect(body.results.map((hit: { entryId: string }) => hit.entryId)).toEqual(["entry-one"]);
    } finally {
      deleteUserById(owner.id);
    }
  });

  test("denies unrelated users reading killed agent logs", async () => {
    const other = claimUserByName(`Killed Other ${crypto.randomUUID()}`, { role: "member" });
    try {
      installKilledAgentHistory("manager-user");
      appendKilledEntry("private killed transcript");
      const token = mintAgentToken("other-live-agent", other.id);

      const res = await handleAgentsRequest(bearerRequest(token, "private"), new URL(`http://local.test/api/agents/${AGENT_ID}/logs?q=private`));

      expect(res?.status).toBe(403);
      expect(await res?.json()).toEqual({ error: "forbidden" });
    } finally {
      deleteUserById(other.id);
    }
  });
});

function authFor(userId: string, username: string, role: "owner" | "member"): AuthResult {
  return {
    kind: "ok",
    session: {
      sessionIdHash: "hash",
      sessionPrefix: "sess",
      userId,
      username,
      role,
      needsRolling: false,
    },
  };
}
