import { describe, expect, test } from "bun:test";
import { initialState } from "./store-initial-state.ts";
import { reducer } from "./store-reducer.ts";
import { appendEntryToStream, clearStreamInReplay, openLogsReplay } from "./store-replay.ts";
import type { LogEntry } from "../shared/types.ts";

function fullState() {
  return {
    type: "full_state" as const,
    agents: [],
    recentCwds: [],
    office: { prompt: null, envFile: null, previewAllowHosts: [], experimental: { browserPanel: false } },
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

  // With no agent focused there is nothing on screen to protect, so full_state
  // still drops every stream outright. The holding path is covered below.
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

describe("reducer: reconnect replay window (full_state → log_replay_complete)", () => {
  const A = "agent-1";
  const B = "agent-2";

  function entry(id: string, agentId: string, timestamp: number): LogEntry {
    return { id, agentId, kind: "text", content: id, timestamp };
  }

  // Every WS reconnect sends full_state and then replays each visible agent's
  // cached transcript one log_entry frame at a time. Clearing `logs` on
  // full_state is what blanked the conversation on a mobile app switch.
  // Focused, because only the focused agent's transcript is on screen and so
  // only that one is held across the window.
  function seeded() {
    return {
      ...reducer(initialState, { type: "log_entry", entry: entry("e1", A, 1) }),
      focusedAgentId: A,
    };
  }

  test("keeps rendering the cached transcript instead of blanking it", () => {
    const after = reducer(seeded(), fullState());
    expect((after.logs.get(A) ?? []).map((e) => e.id)).toEqual(["e1"]);
    expect(after.logsReplay).not.toBeNull();
  });

  test("buffers the replay away from the rendered logs, then swaps atomically", () => {
    let s = reducer(seeded(), fullState());
    // The replay re-sends the entry we already have plus one that landed while
    // we were disconnected.
    s = reducer(s, { type: "log_entry", entry: entry("e1", A, 1) });
    s = reducer(s, { type: "log_entry", entry: entry("e2", A, 2) });
    // Mid-replay the view still shows exactly the pre-reconnect transcript.
    expect((s.logs.get(A) ?? []).map((e) => e.id)).toEqual(["e1"]);
    expect((s.logsReplay?.logs.get(A) ?? []).map((e) => e.id)).toEqual(["e1", "e2"]);
    s = reducer(s, { type: "log_replay_complete" });
    expect((s.logs.get(A) ?? []).map((e) => e.id)).toEqual(["e1", "e2"]);
    expect(s.logsReplay).toBeNull();
    // Dedupe travels with the swap, so a later live entry with a replayed id is
    // still recognized as a duplicate.
    expect(reducer(s, { type: "log_entry", entry: entry("e2", A, 2) })).toBe(s);
  });

  test("REPLACES on commit, so entries the server no longer has are dropped", () => {
    // The case the old wipe existed for: the client was away across a /clear
    // and never saw the clear_logs, so a merge would concatenate the two
    // conversations. The replayed set is the server's and wins outright.
    let s = reducer(seeded(), fullState());
    s = reducer(s, { type: "log_entry", entry: entry("fresh", A, 9) });
    s = reducer(s, { type: "log_replay_complete" });
    expect((s.logs.get(A) ?? []).map((e) => e.id)).toEqual(["fresh"]);
  });

  test("commits an agent to empty when the replay carried nothing for it", () => {
    let s = reducer(seeded(), fullState());
    s = reducer(s, { type: "log_replay_complete" });
    expect(s.logs.get(A) ?? []).toEqual([]);
  });

  test("opens no window when no agent is open (nothing on screen to protect)", () => {
    const unfocused = {
      ...reducer(initialState, { type: "log_entry", entry: entry("e1", A, 1) }),
      focusedAgentId: null,
    };
    const after = reducer(unfocused, fullState());
    expect(after.logsReplay).toBeNull();
    expect(after.logs.size).toBe(0);
  });

  test("holds only the focused agent's transcript, not every visible agent's", () => {
    // Transcripts run to megabytes; nothing renders the other streams, so
    // holding them across the window would double the client's peak for free.
    let s = reducer(seeded(), { type: "log_entry", entry: entry("b1", B, 2) });
    s = reducer(s, fullState());
    expect([...s.logs.keys()]).toEqual([A]);
  });

  test("opens no window on a cold connect (nothing cached to protect)", () => {
    const after = reducer(initialState, fullState());
    expect(after.logsReplay).toBeNull();
    // …and entries then paint straight through, as before.
    const painted = reducer(after, { type: "log_entry", entry: entry("e1", A, 1) });
    expect((painted.logs.get(A) ?? []).map((e) => e.id)).toEqual(["e1"]);
  });

  test("lets a clear_logs mid-replay stick instead of being undone by the commit", () => {
    let s = reducer(seeded(), fullState());
    s = reducer(s, { type: "log_entry", entry: entry("e1", A, 1) });
    s = reducer(s, { type: "clear_logs", agentId: A });
    s = reducer(s, { type: "log_replay_complete" });
    expect(s.logs.get(A) ?? []).toEqual([]);
  });

  test("lets an agent_removed mid-replay stick instead of being undone", () => {
    let s = reducer(seeded(), fullState());
    s = reducer(s, { type: "log_entry", entry: entry("e1", A, 1) });
    s = reducer(s, { type: "agent_removed", agentId: A });
    s = reducer(s, { type: "log_replay_complete" });
    expect(s.logs.has(A)).toBe(false);
  });

  test("keeps streams separate while buffering", () => {
    let s = reducer(seeded(), fullState());
    s = reducer(s, { type: "log_entry", entry: entry("e1", A, 1) });
    s = reducer(s, { type: "log_entry", entry: entry("b1", B, 5) });
    expect((s.logs.get(B) ?? []).map((e) => e.id)).toEqual([]);
    s = reducer(s, { type: "log_replay_complete" });
    expect((s.logs.get(A) ?? []).map((e) => e.id)).toEqual(["e1"]);
    expect((s.logs.get(B) ?? []).map((e) => e.id)).toEqual(["b1"]);
  });

  test("commit outside a window is a no-op, same state object", () => {
    const before = seeded();
    expect(reducer(before, { type: "log_replay_complete" })).toBe(before);
  });

  test("a second full_state mid-window starts a fresh buffer, not a merge", () => {
    // Two reconnects in quick succession (flaky link). The second must not
    // inherit the first's half-arrived replay, and must restart the fallback
    // deadline (seq bumps, which is what the effect's dep list watches).
    let s = reducer(seeded(), fullState());
    s = reducer(s, { type: "log_entry", entry: entry("partial", A, 7) });
    const firstSeq = s.logsReplay?.seq ?? 0;
    s = reducer(s, fullState());
    expect(s.logsReplay?.logs.size).toBe(0);
    expect(s.logsReplay?.seq).toBe(firstSeq + 1);
    // The view still shows the pre-reconnect transcript, not the partial one.
    expect((s.logs.get(A) ?? []).map((e) => e.id)).toEqual(["e1"]);
  });

  test("keeps a live entry that lands right behind the replay burst", () => {
    // The server's send loop is synchronous, so a live emit follows the cached
    // replay rather than interleaving with it. Both must survive the swap.
    let s = reducer(seeded(), fullState());
    s = reducer(s, { type: "log_entry", entry: entry("e1", A, 1) });
    s = reducer(s, { type: "log_entry", entry: entry("live", A, 2) });
    s = reducer(s, { type: "log_replay_complete" });
    expect((s.logs.get(A) ?? []).map((e) => e.id)).toEqual(["e1", "live"]);
  });

  test("routes entries normally again once the window has closed", () => {
    // Anything arriving after the fence must append to the rendered logs, not
    // to a buffer that is no longer there.
    let s = reducer(seeded(), fullState());
    s = reducer(s, { type: "log_replay_complete" });
    s = reducer(s, { type: "log_entry", entry: entry("after", A, 3) });
    expect(s.logsReplay).toBeNull();
    expect((s.logs.get(A) ?? []).map((e) => e.id)).toEqual(["after"]);
    // A second commit can't resurrect the buffer it already consumed.
    const settled = s;
    expect(reducer(settled, { type: "log_replay_complete" })).toBe(settled);
  });

  test("drops a cron run transcript at commit, as full_state already did", () => {
    // The server's reconnect replay is agent-only, so an open cron run's
    // fetched transcript is never in the replayed set. The old full_state wipe
    // dropped it outright; this drops it at the same point (the hold keeps only
    // the focused agent's stream). CronjobRunView backfills it again keyed on
    // hydrationEpoch, and that response lands after the fence — so it paints
    // into the committed logs on the normal path.
    const RUN = "cronrun-run1";
    let s = reducer(seeded(), { type: "log_entry", entry: entry("r1", RUN, 4) });
    s = reducer(s, fullState());
    expect(s.logs.has(RUN)).toBe(false);
    s = reducer(s, { type: "log_entry", entry: entry("e1", A, 1) });
    s = reducer(s, { type: "log_replay_complete" });
    expect(s.logs.has(RUN)).toBe(false);
    s = reducer(s, { type: "log_entry", entry: entry("r1", RUN, 4) });
    expect((s.logs.get(RUN) ?? []).map((e) => e.id)).toEqual(["r1"]);
  });
});

// The reducer cases above are thin wrappers over these; exercised directly here
// because there is no React render harness to drive the swap end to end.
describe("store-replay helpers", () => {
  const entry: LogEntry = { id: "e1", agentId: "agent-1", kind: "text", content: "hi", timestamp: 1 };

  test("appendEntryToStream refuses a duplicate id and never mutates its input", () => {
    const empty = new Map<string, LogEntry[]>();
    const once = appendEntryToStream(empty, entry);
    expect(empty.size).toBe(0);
    expect(once?.get("agent-1")).toEqual([entry]);
    expect(appendEntryToStream(once!, entry)).toBeNull();
  });

  test("clearStreamInReplay is a no-op outside a window", () => {
    expect(clearStreamInReplay(null, "agent-1")).toBeNull();
  });

  test("clearStreamInReplay empties on clear and drops the key on delete", () => {
    const replay = { logs: new Map([["agent-1", [entry]]]), seq: 1 };
    expect(clearStreamInReplay(replay, "agent-1")?.logs.get("agent-1")).toEqual([]);
    expect(clearStreamInReplay(replay, "agent-1", "delete")?.logs.has("agent-1")).toBe(false);
    // The input buffer is untouched either way.
    expect(replay.logs.get("agent-1")).toEqual([entry]);
  });

  test("openLogsReplay carries the window counter forward across reconnects", () => {
    const held = { ...initialState, focusedAgentId: "agent-1", logs: new Map([["agent-1", [entry]]]), logsReplay: { logs: new Map(), seq: 4 } };
    const opened = openLogsReplay(held);
    expect(opened.logsReplay?.seq).toBe(5);
    expect(opened.logs.get("agent-1")).toEqual([entry]);
  });
});
