import { describe, expect, test } from "bun:test";
import { parseSavedView, readSavedView, writeSavedView, type ViewStorage } from "./store-view.ts";

function fakeStorage(init: Record<string, string> = {}): ViewStorage & { data: Record<string, string> } {
  const data = { ...init };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("store-view", () => {
  test("parses valid saved views", () => {
    expect(parseSavedView(JSON.stringify({ user: "nil", roomId: "room-1", agentId: "agent-1", panel: "tasks" }))).toEqual({
      user: "nil",
      roomId: "room-1",
      agentId: "agent-1",
      panel: "tasks",
    });
    expect(parseSavedView(JSON.stringify({ user: "nil" }))).toEqual({ user: "nil", roomId: null, agentId: null, panel: null });
  });

  test("rejects malformed or unknown values", () => {
    expect(parseSavedView(null)).toBeNull();
    expect(parseSavedView("bad json")).toBeNull();
    expect(parseSavedView(JSON.stringify({ user: "" }))).toBeNull();
    expect(parseSavedView(JSON.stringify({ user: "nil", roomId: "" }))).toBeNull();
    expect(parseSavedView(JSON.stringify({ user: "nil", panel: "settings" }))).toBeNull();
  });

  test("round trips by normalized user", () => {
    const store = fakeStorage();
    writeSavedView("Nil", { roomId: "room-1", agentId: null, panel: "plugins" }, store);

    expect(readSavedView("nil", store)).toEqual({ user: "nil", roomId: "room-1", agentId: null, panel: "plugins" });
    expect(readSavedView("other", store)).toBeNull();
  });
});
