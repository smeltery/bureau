import { beforeEach, describe, expect, test } from "bun:test";
import { createManagedAgent } from "../managed-factory.ts";
import { liveTurnAnchor } from "../slides.ts";
import { createTurnDeferred } from "../session/runtime.ts";
import { addLogEntry, agents, logCache } from "../state.ts";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo, type AgentState } from "../../../shared/types.ts";

// Slide Mode's terminal boundary depends on ONE fact: which turn the agent is
// producing right now. These cover the two halves that establish it — the anchor
// park/claim protocol across addLogEntry and createTurnDeferred, and the
// liveTurnAnchor read that turns those fields back into "the live turn".

function info(state: AgentState): AgentInfo {
  return {
    id: "anchor-agent",
    name: "Anchor",
    desk: 0,
    room: 0,
    cwd: process.cwd(),
    outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state,
    topic: null,
    topicStale: false,
    customInstructions: null,
    effort: "high",
  };
}

function managedIn(state: AgentState) {
  const managed = createManagedAgent({ info: info(state), skillCwd: process.cwd(), slashCommands: [], skills: [] });
  agents.set(managed.info.id, managed);
  return managed;
}

beforeEach(() => {
  agents.clear();
  logCache.clear();
});

describe("liveTurnAnchor", () => {
  test("an idle agent has no live turn, even with an anchor parked", () => {
    const managed = managedIn("idle");
    managed.nextTurnAnchorEntryId = "u1";

    // A user_message that never starts a turn (a control command's echo) must not
    // make its deck position look in-flight.
    expect(liveTurnAnchor(managed)).toBeNull();
  });

  test("a BUSY agent whose deferred does not exist yet reads the parked anchor", () => {
    const managed = managedIn("thinking");
    managed.nextTurnAnchorEntryId = "u1";

    // The window between logging the message and installing the deferred: without
    // this the live turn reads terminal and gets a placeholder written over it.
    expect(liveTurnAnchor(managed)).toBe("u1");
  });

  test("the deferred takes precedence, so a leftover park is never inherited", () => {
    const managed = managedIn("thinking");
    managed.nextTurnAnchorEntryId = "stale";
    managed.pendingTurn = { promise: Promise.resolve(), resolve: () => {}, reject: () => {}, anchorEntryId: null };

    // A queued flush logs its own anchor AFTER the send: anchorless is the right
    // answer until addLogEntry stamps it, not somebody else's message.
    expect(liveTurnAnchor(managed)).toBeNull();
  });

  test("a completed turn (pendingTurn nulled, still busy-free) is terminal again", () => {
    const managed = managedIn("waiting_for_response");
    managed.nextTurnAnchorEntryId = "u1";

    expect(liveTurnAnchor(managed)).toBeNull();
  });
});

describe("the anchor park/claim protocol", () => {
  test("a user_message logged before the deferred is PARKED, then claimed once", () => {
    const managed = managedIn("thinking");

    addLogEntry(managed.info.id, "user_message", "hello");
    const parked = managed.nextTurnAnchorEntryId;
    expect(parked).not.toBeNull();

    createTurnDeferred(managed);

    expect(managed.pendingTurn?.anchorEntryId).toBe(parked);
    // Cleared on claim: the NEXT turn must start anchorless rather than inherit
    // this one's message.
    expect(managed.nextTurnAnchorEntryId).toBeNull();
  });

  test("a user_message logged while a turn already runs stamps that turn directly", () => {
    const managed = managedIn("thinking");
    createTurnDeferred(managed);
    expect(managed.pendingTurn?.anchorEntryId).toBeNull();

    // The queued-flush path: onSendAccepted logs the message after the deferred
    // exists.
    addLogEntry(managed.info.id, "user_message", "flushed");

    expect(managed.pendingTurn?.anchorEntryId).not.toBeNull();
    expect(managed.nextTurnAnchorEntryId).toBeNull();
  });

  test("the last message of a coalesced flush wins the anchor", () => {
    const managed = managedIn("thinking");
    createTurnDeferred(managed);

    addLogEntry(managed.info.id, "user_message", "first");
    const first = managed.pendingTurn?.anchorEntryId;
    addLogEntry(managed.info.id, "user_message", "second");

    // The agent's response attaches to the last one, so that is the deck turn the
    // answer belongs to.
    expect(managed.pendingTurn?.anchorEntryId).not.toBe(first);
    const entries = logCache.get(managed.info.id) ?? [];
    expect(managed.pendingTurn?.anchorEntryId).toBe(entries.at(-1)?.id);
  });

  test("a non-user_message entry never becomes an anchor", () => {
    const managed = managedIn("thinking");

    addLogEntry(managed.info.id, "text", "an answer");
    addLogEntry(managed.info.id, "error", "a failure");

    expect(managed.nextTurnAnchorEntryId).toBeNull();
  });

  test("a superseding turn does not inherit the superseded turn's anchor", () => {
    const managed = managedIn("thinking");
    addLogEntry(managed.info.id, "user_message", "first");
    createTurnDeferred(managed);
    const first = managed.pendingTurn?.anchorEntryId;

    // createTurnDeferred rejects the stale deferred and installs a fresh one; the
    // park was already consumed, so the new turn is anchorless until its own
    // message lands.
    createTurnDeferred(managed);

    expect(first).not.toBeNull();
    expect(managed.pendingTurn?.anchorEntryId).toBeNull();
  });
});
