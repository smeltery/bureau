// Shared fixture for the two privileged-agent authorization suites
// (privileged-agent-office.test.ts = what a privileged token may do,
// privileged-agent-boundaries.test.ts = what it may never do).
//
// The office it builds:
//   - `manager`      — a MEMBER who can see only the first room.
//   - `ownerManager` — an OWNER, used for the owner-only room-create path.
//   - visible room   — rooms[0], in `manager.allowedRooms`.
//   - hidden room    — freshly created, in NOBODY's allowedRooms.
// Agents: an operator (privileged, managed by `manager`), an owner-managed
// operator (privileged), a plain operator (NOT privileged), a target in the
// visible room, and a target in the hidden room.
//
// Every request in both suites passes `auth` as undefined / loopback rather than
// a browser session, so what is being measured is the TOKEN's authority alone.
import { createManagedAgent } from "../../agents/managed-factory.ts";
import { agents } from "../../agents/state.ts";
import { _testResetAgentTokens, mintAgentToken } from "../../agents/tokens.ts";
import * as AgentManager from "../../agent-manager.ts";
import { claimUserByName, deleteUserById, getUserById, updateUserById } from "../../users.ts";
import { loadAgentHistory, saveAgentHistory } from "../../persistence.ts";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo, type UserRecord } from "../../../shared/types.ts";

export const OPERATOR_AGENT = "priv-operator";
export const OWNER_OPERATOR_AGENT = "priv-owner-operator";
export const PLAIN_AGENT = "priv-plain";
export const TARGET_AGENT = "priv-target";
export const HIDDEN_AGENT = "priv-hidden";
export const UNROOTED_AGENT = "priv-unrooted";

const FIXTURE_AGENT_IDS = [OPERATOR_AGENT, OWNER_OPERATOR_AGENT, PLAIN_AGENT, TARGET_AGENT, HIDDEN_AGENT, UNROOTED_AGENT];

export interface PrivilegedFixture {
  manager: UserRecord;
  ownerManager: UserRecord;
  visibleRoomId: string;
  hiddenRoomId: string;
  /** Token of a privileged agent whose manager is a MEMBER who can see only the visible room. */
  privilegedToken: string;
  /** Token of a privileged agent whose manager is an OWNER (needed for room create). */
  ownerPrivilegedToken: string;
  /** Token of a NON-privileged agent with the same manager — the control group. */
  plainToken: string;
}

export function setupPrivilegedFixture(): PrivilegedFixture {
  _testResetAgentTokens();
  agents.clear();

  const visibleRoomId = AgentManager.getRooms()[0]!.id;
  const hiddenRoomId = AgentManager.createRoom("Privilege Fixture Hidden");
  const hiddenRoomIndex = AgentManager.getRooms().findIndex((room) => room.id === hiddenRoomId);

  const member = claimUserByName(`Priv Member ${crypto.randomUUID()}`, { role: "member" });
  updateUserById(member.id, { allowedRooms: [visibleRoomId] });
  const owner = claimUserByName(`Priv Owner ${crypto.randomUUID()}`, { role: "owner" });
  const manager = getUserById(member.id)!;
  const ownerManager = getUserById(owner.id)!;

  installAgent(OPERATOR_AGENT, 0, manager.id);
  installAgent(OWNER_OPERATOR_AGENT, 0, ownerManager.id);
  installAgent(PLAIN_AGENT, 0, manager.id);
  installAgent(TARGET_AGENT, 0, manager.id);
  installAgent(HIDDEN_AGENT, hiddenRoomIndex, manager.id);
  // Deliberately cwd-less: routes that start a fresh backend session are proved
  // to have PASSED authorization by returning 204, and this agent's invalid cwd
  // makes the fire-and-forget session creation fail its preflight instead of
  // spawning a real CLI subprocess inside the test run.
  installAgent(UNROOTED_AGENT, 0, manager.id, "/nonexistent/bureau-privileged-fixture");

  return {
    manager,
    ownerManager,
    visibleRoomId,
    hiddenRoomId,
    privilegedToken: mintAgentToken(OPERATOR_AGENT, manager.id, true),
    ownerPrivilegedToken: mintAgentToken(OWNER_OPERATOR_AGENT, ownerManager.id, true),
    plainToken: mintAgentToken(PLAIN_AGENT, manager.id, false),
  };
}

export function teardownPrivilegedFixture(fixture: PrivilegedFixture): void {
  agents.clear();
  AgentManager.closeRoom(fixture.hiddenRoomId);
  deleteUserById(fixture.manager.id);
  deleteUserById(fixture.ownerManager.id);
  _testResetAgentTokens();
  // `kill` stamps a killed-agent history entry; drop the fixture's so the office
  // running these tests doesn't accumulate phantom revive chips.
  const history = loadAgentHistory();
  let touched = false;
  for (const id of FIXTURE_AGENT_IDS) {
    if (id in history) {
      delete history[id];
      touched = true;
    }
  }
  if (touched) saveAgentHistory(history);
}

export function grantRooms(userId: string, roomIds: string[]): void {
  updateUserById(userId, { allowedRooms: roomIds });
}

export function bearerRequest(path: string, token: string, init: RequestInit = {}): Request {
  return new Request(`http://local.test${path}`, {
    method: init.method ?? "POST",
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });
}

export function installAgent(id: string, room: number, userId: string, cwd: string = process.cwd()): void {
  const info: AgentInfo = {
    id,
    name: `Agent ${id}`,
    desk: 0,
    room,
    cwd,
    outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: null,
    privileged: false,
    userId,
  };
  agents.set(id, createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] }));
}
