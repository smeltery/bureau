import { expect, test } from "bun:test";
import { reducer } from "../store-reducer.ts";
import { initialState } from "../store-initial-state.ts";
import type { Action } from "../store.tsx";
import type { SessionContext } from "../../shared/types.ts";
const context = (userId: string): SessionContext => ({ userId, username: userId, role: "member", currentSessionPrefix: "session", connectionId: "connection" });
const summary = { userId: "alice", readPointer: null, unread: 3, latestId: "last" };
const fullState: Action = { type: "full_state", agents: [], recentCwds: [], office: initialState.office, rooms: [], killedAgents: [], membersChat: summary };

test("initial unread summary survives full_state before session_context, and legacy frames preserve it", () => {
  let state = reducer(initialState, fullState);
  state = reducer(state, { type: "session_context", context: context("alice") });
  expect(state.membersChat).toEqual(summary);
  state = reducer(state, { ...fullState, membersChat: undefined });
  expect(state.membersChat).toEqual(summary);
  state = reducer(state, { type: "members_chat_summary", summary: { ...summary, unread: 0, readPointer: "last" } });
  expect(state.membersChat?.unread).toBe(0);
});
test("a change of member clears old unread state and ignores another member's live summary", () => {
  let state = reducer(initialState, fullState);
  state = reducer(state, { type: "session_context", context: context("bob") });
  expect(state.membersChat).toBeNull();
  expect(reducer(state, { type: "members_chat_summary", summary }).membersChat).toBeNull();
  const mine = { ...summary, userId: "bob", unread: 7 };
  expect(reducer(state, { type: "members_chat_summary", summary: mine }).membersChat).toEqual(mine);
});
