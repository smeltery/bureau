// The privileged-agent authority gate, which had no test at all.
//
// `privilegedAgentIdentity` is the ONE place bureau turns a token's `privileged`
// bit into real server-side authority, and the two `...AllowingPrivileged`
// helpers are what hold that authority inside the manager's rooms. Everything
// this file asserts is a REFUSAL, because that is where the value is: every
// route that management authority reaches was made reachable by this code, so a
// silent widening here is a privileged agent acting outside its boss's office
// rather than a visible error somewhere.
//
// Two refusals are load-bearing rather than defensive, and both are easy to
// "simplify" away by someone who has not read `canSeeRoom`:
//
//   canSeeRoom(null, anyRoom) === true
//
// A no-user caller is treated as unrestricted, so a privileged token that names
// no manager, or names a manager who has since been deleted, must be refused
// BEFORE any room check. Drop either guard and the room check that looks like
// the security boundary silently answers "yes, every room". The last test pins
// that primitive directly so the reason survives.

import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { _testResetAgentTokens, mintAgentToken } from "../../agents/tokens.ts";
import { agents, rooms } from "../../agents/state.ts";
import { createManagedAgent } from "../../agents/managed-factory.ts";
import { canSeeRoom, claimUserByName, deleteUserById, getUserByName } from "../../users.ts";
import { privilegedAgentIdentity, requireAgentAccessAllowingPrivileged, requireRoomAccessAllowingPrivileged, requireUserAgentAccess } from "../agent-route-helpers.ts";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";

const AGENT_ID = "agent-privileged-test";
const MANAGER_NAME = "Route Helper Manager";
const OTHER_ROOM_ID = "room-the-manager-cannot-see";

// The office always boots with one room; the agent under test sits in it.
const homeRoomId = () => rooms[0]!.id;

beforeEach(reset);
afterEach(reset);

function reset() {
  _testResetAgentTokens();
  agents.clear();
  const existing = getUserByName(MANAGER_NAME);
  if (existing) deleteUserById(existing.id);
}

function installAgent(id = AGENT_ID) {
  const info: AgentInfo = {
    id,
    name: "Privileged Test Agent",
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: null,
    effort: "high",
  };
  agents.set(id, createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] }));
}

/** A member manager who can see only the rooms listed. */
function manager(allowedRooms: string[]) {
  return claimUserByName(MANAGER_NAME, { role: "member", allowedRooms });
}

function bearer(token: string | null): Request {
  return new Request("http://local.test/api/agents/x/kill", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
}

const loopback: AuthResult = { kind: "loopback" };

describe("privilegedAgentIdentity", () => {
  test("a request with no bearer token is not an operator", () => {
    expect(privilegedAgentIdentity(bearer(null))).toBeNull();
  });

  test("a token that resolves to nothing is not an operator", () => {
    installAgent();
    mintAgentToken(AGENT_ID, "someone", true);
    expect(privilegedAgentIdentity(bearer("not-the-minted-token"))).toBeNull();
  });

  test("an ordinary agent token carries no management authority", () => {
    installAgent();
    const user = manager([homeRoomId()]);
    const token = mintAgentToken(AGENT_ID, user.id, false);

    expect(privilegedAgentIdentity(bearer(token))).toBeNull();
  });

  test("a privileged token naming NO manager is refused, because a null user can see every room", () => {
    installAgent();
    const token = mintAgentToken(AGENT_ID, null, true);

    expect(privilegedAgentIdentity(bearer(token))).toBeNull();
  });

  test("a privileged token whose manager has been deleted is refused for the same reason", () => {
    installAgent();
    const user = manager([homeRoomId()]);
    const token = mintAgentToken(AGENT_ID, user.id, true);
    // The boss leaves the office; the token outlives them.
    deleteUserById(user.id);

    expect(privilegedAgentIdentity(bearer(token))).toBeNull();
  });

  test("a privileged token with a live manager resolves to that manager", () => {
    installAgent();
    const user = manager([homeRoomId()]);
    const token = mintAgentToken(AGENT_ID, user.id, true);

    const identity = privilegedAgentIdentity(bearer(token));

    expect(identity?.agentId).toBe(AGENT_ID);
    expect(identity?.manager.id).toBe(user.id);
  });
});

describe("requireAgentAccessAllowingPrivileged", () => {
  test("a privileged agent reaches an agent its manager can see", () => {
    installAgent();
    const user = manager([homeRoomId()]);
    const token = mintAgentToken(AGENT_ID, user.id, true);

    expect(requireAgentAccessAllowingPrivileged(bearer(token), loopback, AGENT_ID)).toBeNull();
  });

  test("being PRIVILEGED narrows a loopback caller rather than widening it", async () => {
    // The route's own auth accepts loopback outright, so without the privileged
    // branch this same request is allowed. Holding a privileged token must not
    // buy MORE than the manager can see — this is the property that makes the
    // gate safe to mount on routes that already trust the local box.
    installAgent();
    const user = manager([OTHER_ROOM_ID]); // anything except the agent's room
    const token = mintAgentToken(AGENT_ID, user.id, true);

    expect(requireUserAgentAccess(loopback, AGENT_ID)).toBeNull();

    const denied = requireAgentAccessAllowingPrivileged(bearer(token), loopback, AGENT_ID);
    expect(denied?.status).toBe(403);
    expect(await denied?.json()).toEqual({ error: "forbidden" });
  });

  test("a privileged agent asking about an agent that does not exist gets 404, not 403", () => {
    const user = manager([homeRoomId()]);
    installAgent();
    const token = mintAgentToken(AGENT_ID, user.id, true);

    expect(requireAgentAccessAllowingPrivileged(bearer(token), loopback, "agent-does-not-exist")?.status).toBe(404);
  });

  test("without a privileged token the unchanged session rule still applies", () => {
    installAgent();

    expect(requireAgentAccessAllowingPrivileged(bearer(null), loopback, AGENT_ID)).toBeNull();
    expect(requireAgentAccessAllowingPrivileged(bearer(null), undefined, AGENT_ID)?.status).toBe(401);
  });

  test("a stale privileged token with no session behind it does not become office-wide access", () => {
    // The consequence the identity guard exists to prevent, asserted on the
    // authority path rather than on the resolver. A deleted manager must leave
    // the caller with NO operator identity, so the request falls back to the
    // ordinary session rule and is refused. Let a null manager through and
    // `canSeeRoom(null, ...)` answers "yes" for every room — an unauthenticated
    // holder of a stale token would be admitted to an agent nobody can vouch
    // for, and the room check that looks like the boundary would have approved
    // it.
    installAgent();
    const user = manager([OTHER_ROOM_ID]);
    const token = mintAgentToken(AGENT_ID, user.id, true);
    deleteUserById(user.id);

    expect(requireAgentAccessAllowingPrivileged(bearer(token), undefined, AGENT_ID)?.status).toBe(401);
    expect(requireRoomAccessAllowingPrivileged(bearer(token), undefined, homeRoomId())?.status).toBe(401);
  });
});

describe("requireRoomAccessAllowingPrivileged", () => {
  test("a privileged agent is held to its manager's rooms even under loopback", () => {
    installAgent();
    const user = manager([homeRoomId()]);
    const token = mintAgentToken(AGENT_ID, user.id, true);

    expect(requireRoomAccessAllowingPrivileged(bearer(token), loopback, homeRoomId())).toBeNull();
    expect(requireRoomAccessAllowingPrivileged(bearer(token), loopback, OTHER_ROOM_ID)?.status).toBe(403);
  });
});

describe("the primitive both refusals depend on", () => {
  test("canSeeRoom treats a null user as able to see everything", () => {
    // Not a bug — it is how loopback and pre-multi-user records stay working.
    // It is also exactly why privilegedAgentIdentity must reject a token with no
    // live manager instead of leaving the decision to the room check.
    expect(canSeeRoom(null, "any-room-at-all")).toBe(true);
  });
});
