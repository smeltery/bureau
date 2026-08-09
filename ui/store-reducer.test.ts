import { describe, expect, test } from "bun:test";
import { initialState } from "./store-initial-state.ts";
import { reducer } from "./store-reducer.ts";
import type { LogEntry } from "../shared/types.ts";

function fullState() {
  return {
    type: "full_state" as const,
    agents: [],
    recentCwds: [],
    office: { prompt: null, envFile: null, previewAllowHosts: [] },
    rooms: [],
    killedAgents: [],
  };
}

describe("full_state hydration", () => {
  test("bumps hydrationEpoch on every full_state", () => {
    const once = reducer(initialState, fullState());
    const twice = reducer(once, fullState());

    expect(initialState.hydrationEpoch).toBe(0);
    expect(once.hydrationEpoch).toBe(1);
    expect(twice.hydrationEpoch).toBe(2);
  });

  test("wipes the logs map — the reason epoch-keyed views must refetch", () => {
    const entry: LogEntry = { id: "e1", agentId: "agent-1", kind: "system", content: "hi", timestamp: 1 };
    const withLogs = { ...initialState, logs: new Map([["stream-1", [entry]]]) };

    const hydrated = reducer(withLogs, fullState());

    expect(hydrated.logs.size).toBe(0);
    expect(hydrated.hydrationEpoch).toBe(1);
  });

  test("other actions leave the epoch alone", () => {
    const hydrated = reducer(initialState, fullState());
    const after = reducer(hydrated, { type: "set_current_room", room: 0 });

    expect(after.hydrationEpoch).toBe(1);
  });
});
