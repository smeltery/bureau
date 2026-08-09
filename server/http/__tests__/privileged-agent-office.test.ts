// What a PRIVILEGED agent token may actually do — the routes that make the
// "server-side authorization" claim in the privileged system prompt true.
//
// Two things are pinned per route: a privileged token is ACCEPTED inside its
// manager's room/agent visibility, and REFUSED outside it. A plain (non
// privileged) agent token is the control group and must get nothing.
//
// Where a route's effect would start a real backend session or spawn a process,
// the assertion lands on the validation error immediately AFTER the auth gate
// (422) — reaching that error is itself proof authorization passed.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as AgentManager from "../../agent-manager.ts";
import { agents } from "../../agents/state.ts";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { handleAgentsRequest } from "../agents.ts";
import { handleRoomsRequest } from "../rooms.ts";
import { bearerRequest, grantRooms, HIDDEN_AGENT, setupPrivilegedFixture, TARGET_AGENT, teardownPrivilegedFixture, UNROOTED_AGENT, type PrivilegedFixture } from "./privileged-agent-fixture.ts";

// Loopback is the strictest realistic non-session auth for a local agent's curl;
// the room routes refuse it outright, so anything that passes below passed on the
// strength of the bearer token alone.
const noSession: AuthResult = { kind: "loopback" };

let fixture: PrivilegedFixture;

beforeEach(() => {
  fixture = setupPrivilegedFixture();
});

afterEach(() => {
  teardownPrivilegedFixture(fixture);
});

function rooms(path: string, token: string, init: RequestInit = {}): Promise<Response | null> {
  const req = bearerRequest(path, token, init);
  return handleRoomsRequest(req, new URL(req.url), noSession);
}

// Agent routes get `undefined` auth: no browser session and no loopback trust, so
// the only thing that can authorize the call is the token itself.
function agentRoute(path: string, token: string, init: RequestInit = {}): Promise<Response | null> {
  const req = bearerRequest(path, token, init);
  return handleAgentsRequest(req, new URL(req.url), undefined);
}

describe("privileged agent — rooms", () => {
  test("creates a room when its manager is an owner, and never when the manager is a member", async () => {
    const memberAttempt = await rooms("/api/rooms", fixture.privilegedToken, { body: JSON.stringify({ name: "Member Attempt" }) });
    expect(memberAttempt?.status).toBe(403);
    expect(await memberAttempt?.json()).toEqual({ error: "owner access required" });

    const ownerAttempt = await rooms("/api/rooms", fixture.ownerPrivilegedToken, { body: JSON.stringify({ name: "Owner Agent Room" }) });
    expect(ownerAttempt?.status).toBe(201);
    const created = (await ownerAttempt!.json()) as { room: { id: string; name: string } };
    expect(created.room.name).toBe("Owner Agent Room");
    AgentManager.closeRoom(created.room.id);
  });

  test("renames, reads and writes settings, and closes a room its manager can see", async () => {
    const originalName = AgentManager.getRooms()[0]!.name;
    const renamed = await rooms(`/api/rooms/${fixture.visibleRoomId}`, fixture.privilegedToken, { method: "PATCH", body: JSON.stringify({ name: "Renamed By Agent" }) });
    expect(renamed?.status).toBe(204);
    expect(AgentManager.getRooms()[0]!.name).toBe("Renamed By Agent");
    AgentManager.renameRoom(fixture.visibleRoomId, originalName);

    const read = await rooms(`/api/rooms/${fixture.visibleRoomId}/settings`, fixture.privilegedToken, { method: "GET" });
    expect(read?.status).toBe(200);
    const version = ((await read!.json()) as { version: string }).version;
    const written = await rooms(`/api/rooms/${fixture.visibleRoomId}/settings`, fixture.privilegedToken, {
      method: "PUT",
      body: JSON.stringify({ prompt: "Agent-written prompt", envFile: null, version }),
    });
    expect(written?.status).toBe(204);
    expect(AgentManager.getRoomSettings(fixture.visibleRoomId)?.prompt).toBe("Agent-written prompt");
    AgentManager.setRoomSettings(fixture.visibleRoomId, null, null);

    const closable = AgentManager.createRoom("Closable By Agent");
    grantRooms(fixture.manager.id, [fixture.visibleRoomId, closable]);
    const closed = await rooms(`/api/rooms/${closable}`, fixture.privilegedToken, { method: "DELETE" });
    expect(closed?.status).toBe(204);
    expect(AgentManager.getRooms().some((room) => room.id === closable)).toBe(false);
  });

  test("swaps desks in a room its manager can see", async () => {
    const swapped = await rooms(`/api/rooms/${fixture.visibleRoomId}/swap-desks`, fixture.privilegedToken, { body: JSON.stringify({ deskA: 0, deskB: 1 }) });

    expect(swapped?.status).toBe(204);
  });

  test("is refused on every room operation outside its manager's rooms", async () => {
    const attempts = [
      await rooms(`/api/rooms/${fixture.hiddenRoomId}`, fixture.privilegedToken, { method: "PATCH", body: JSON.stringify({ name: "Nope" }) }),
      await rooms(`/api/rooms/${fixture.hiddenRoomId}`, fixture.privilegedToken, { method: "DELETE" }),
      await rooms(`/api/rooms/${fixture.hiddenRoomId}/settings`, fixture.privilegedToken, { method: "PUT", body: JSON.stringify({ prompt: "Nope", envFile: null, version: "x" }) }),
      await rooms(`/api/rooms/${fixture.hiddenRoomId}/swap-desks`, fixture.privilegedToken, { body: JSON.stringify({ deskA: 0, deskB: 1 }) }),
    ];

    for (const res of attempts) {
      expect(res?.status).toBe(403);
      expect(await res?.json()).toEqual({ error: "room access required" });
    }
    expect(AgentManager.getRooms().some((room) => room.id === fixture.hiddenRoomId)).toBe(true);
  });

  test("refuses a non-privileged agent token on every room route", async () => {
    const create = await rooms("/api/rooms", fixture.plainToken, { body: JSON.stringify({ name: "Plain Attempt" }) });
    const rename = await rooms(`/api/rooms/${fixture.visibleRoomId}`, fixture.plainToken, { method: "PATCH", body: JSON.stringify({ name: "Plain Rename" }) });

    for (const res of [create, rename]) {
      expect(res?.status).toBe(401);
      expect(await res?.json()).toEqual({ error: "authenticated browser session required" });
    }
  });
});

describe("privileged agent — agent lifecycle", () => {
  test("spawns into a room its manager can see, attributed to that manager", async () => {
    // Auth and room access both cleared; the 422 comes from the cwd check that
    // runs immediately after, so no agent is actually spawned in the test office.
    const accepted = await agentRoute("/api/agents", fixture.privilegedToken, {
      body: JSON.stringify({ name: "Hired", cwd: "/nonexistent/bureau-spawn-check", roomId: fixture.visibleRoomId, desk: 3 }),
    });

    expect(accepted?.status).toBe(422);
    expect(((await accepted!.json()) as { error: string }).error).toContain("does not exist");
  });

  test("is refused when spawning into a room its manager cannot see", async () => {
    const res = await agentRoute("/api/agents", fixture.privilegedToken, {
      body: JSON.stringify({ name: "Hired", cwd: process.cwd(), roomId: fixture.hiddenRoomId, desk: 3 }),
    });

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "forbidden" });
  });

  test("refuses a non-privileged agent token on spawn", async () => {
    const res = await agentRoute("/api/agents", fixture.plainToken, {
      body: JSON.stringify({ name: "Hired", cwd: process.cwd(), roomId: fixture.visibleRoomId, desk: 3 }),
    });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({ error: "unauthenticated" });
  });

  test("kills, edits, moves and re-topics an agent its manager can see", async () => {
    const topic = await agentRoute(`/api/agents/${TARGET_AGENT}/topic`, fixture.privilegedToken, { method: "PUT", body: JSON.stringify({ topic: "Set by operator" }) });
    expect(topic?.status).toBe(204);
    expect(AgentManager.getAgent(TARGET_AGENT)?.topic).toBe("Set by operator");

    const clearTopic = await agentRoute(`/api/agents/${TARGET_AGENT}/topic`, fixture.privilegedToken, { method: "DELETE" });
    expect(clearTopic?.status).toBe(204);

    // Past the agent gate; the 422 is the body check that follows it.
    const edit = await agentRoute(`/api/agents/${TARGET_AGENT}`, fixture.privilegedToken, { method: "PATCH", body: JSON.stringify({ cwd: "/nonexistent/bureau-edit-check" }) });
    expect(edit?.status).toBe(422);
    const move = await agentRoute(`/api/agents/${TARGET_AGENT}/move`, fixture.privilegedToken, { body: JSON.stringify({}) });
    expect(move?.status).toBe(422);
    expect(await move?.json()).toEqual({ error: "targetRoomId is required" });

    const killed = await agentRoute(`/api/agents/${TARGET_AGENT}`, fixture.privilegedToken, { method: "DELETE" });
    expect(killed?.status).toBe(204);
    expect(agents.has(TARGET_AGENT)).toBe(false);
  });

  test("is refused a move whose destination its manager cannot see", async () => {
    const res = await agentRoute(`/api/agents/${TARGET_AGENT}/move`, fixture.privilegedToken, { body: JSON.stringify({ targetRoomId: fixture.hiddenRoomId }) });

    expect(res?.status).toBe(403);
    expect(await res?.json()).toEqual({ error: "forbidden" });
    expect(AgentManager.getAgent(TARGET_AGENT)?.room).toBe(0);
  });

  test("steers the conversation of an agent its manager can see", async () => {
    const resume = await agentRoute(`/api/agents/${TARGET_AGENT}/resume`, fixture.privilegedToken, { body: JSON.stringify({}) });
    expect(resume?.status).toBe(422);
    expect(await resume?.json()).toEqual({ error: "sessionId is required" });

    const sendNow = await agentRoute(`/api/agents/${TARGET_AGENT}/send-now`, fixture.privilegedToken, { body: JSON.stringify({}) });
    expect(sendNow?.status).toBe(204);
    const dequeued = await agentRoute(`/api/agents/${TARGET_AGENT}/queue/missing-message`, fixture.privilegedToken, { method: "DELETE" });
    expect(dequeued?.status).toBe(204);
    const fresh = await agentRoute(`/api/agents/${UNROOTED_AGENT}/new-conversation`, fixture.privilegedToken, { body: JSON.stringify({}) });
    expect(fresh?.status).toBe(204);
  });

  test("is refused every lifecycle and steering route for an agent outside its manager's rooms", async () => {
    for (const res of await hiddenAgentAttempts(fixture.privilegedToken)) {
      expect(res?.status).toBe(403);
      expect(await res?.json()).toEqual({ error: "forbidden" });
    }
    expect(agents.has(HIDDEN_AGENT)).toBe(true);
  });

  test("refuses a non-privileged agent token on every lifecycle and steering route", async () => {
    for (const res of await hiddenAgentAttempts(fixture.plainToken, TARGET_AGENT)) {
      expect(res?.status).toBe(401);
      expect(await res?.json()).toEqual({ error: "unauthenticated" });
    }
    expect(agents.has(TARGET_AGENT)).toBe(true);
    expect(AgentManager.getAgent(TARGET_AGENT)?.topic).toBeNull();
  });
});

function hiddenAgentAttempts(token: string, agentId: string = HIDDEN_AGENT): Promise<(Response | null)[]> {
  return Promise.all([
    agentRoute(`/api/agents/${agentId}`, token, { method: "DELETE" }),
    agentRoute(`/api/agents/${agentId}`, token, { method: "PATCH", body: JSON.stringify({ name: "Renamed" }) }),
    agentRoute(`/api/agents/${agentId}/move`, token, { body: JSON.stringify({ targetRoomId: "room-1" }) }),
    agentRoute(`/api/agents/${agentId}/topic`, token, { method: "PUT", body: JSON.stringify({ topic: "Nope" }) }),
    agentRoute(`/api/agents/${agentId}/topic`, token, { method: "DELETE" }),
    agentRoute(`/api/agents/${agentId}/resume`, token, { body: JSON.stringify({ sessionId: "s-1" }) }),
    agentRoute(`/api/agents/${agentId}/new-conversation`, token, { body: JSON.stringify({}) }),
    agentRoute(`/api/agents/${agentId}/send-now`, token, { body: JSON.stringify({}) }),
    agentRoute(`/api/agents/${agentId}/queue/missing-message`, token, { method: "DELETE" }),
  ]);
}
