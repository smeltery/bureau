import { describe, expect, test } from "bun:test";
import { initialState } from "./store-initial-state.ts";
import { reducer } from "./store-reducer.ts";

describe("lobbyOpen", () => {
  test("opens and closes via set_lobby_open", () => {
    const open = reducer(initialState, { type: "set_lobby_open", open: true });
    expect(open.lobbyOpen).toBe(true);
    expect(reducer(open, { type: "set_lobby_open", open: false }).lobbyOpen).toBe(false);
  });

  test("selecting a desk room closes the lobby", () => {
    const open = reducer(initialState, { type: "set_lobby_open", open: true });
    const next = reducer(open, { type: "set_current_room", room: 0 });
    expect(next.lobbyOpen).toBe(false);
    expect(next.currentRoom).toBe(0);
  });
});
