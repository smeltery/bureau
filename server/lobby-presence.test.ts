import { expect, test } from "bun:test";
import { LOBBY_SPOT_IDS } from "../shared/lobby.ts";
import { assignLobbySpot, pickLobbySpot } from "./lobby-presence.ts";

const row = (connectionId: string, lobbySpotId: string | null) => ({ connectionId, lobbySpotId });

test("entry picks a free seat without moving anyone else", () => {
  const first = assignLobbySpot([], LOBBY_SPOT_IDS, "a", () => 0);
  expect(first.lobbySpotId).not.toBeNull();
  expect((LOBBY_SPOT_IDS as readonly string[]).includes(first.lobbySpotId!)).toBe(true);
  const second = assignLobbySpot([first], LOBBY_SPOT_IDS, "b", () => 0);
  expect(second.lobbySpotId).not.toBe(first.lobbySpotId);
  expect((LOBBY_SPOT_IDS as readonly string[]).includes(second.lobbySpotId!)).toBe(true);
});

test("move claims a free seat and rejects occupied or unknown seats", () => {
  const seated = [row("a", LOBBY_SPOT_IDS[0]), row("b", LOBBY_SPOT_IDS[1])];
  const free = LOBBY_SPOT_IDS[2]!;
  expect(pickLobbySpot(seated, LOBBY_SPOT_IDS, "a", free).find((p) => p.connectionId === "a")?.lobbySpotId).toBe(free);
  expect(pickLobbySpot(seated, LOBBY_SPOT_IDS, "a", LOBBY_SPOT_IDS[1]!).find((p) => p.connectionId === "a")?.lobbySpotId).toBe(LOBBY_SPOT_IDS[0]);
  expect(pickLobbySpot(seated, LOBBY_SPOT_IDS, "a", "unknown-seat").find((p) => p.connectionId === "a")?.lobbySpotId).toBe(LOBBY_SPOT_IDS[0]);
});

test("overflow when every seat is taken", () => {
  const full = LOBBY_SPOT_IDS.map((id, i) => row(String(i), id));
  const next = assignLobbySpot(full, LOBBY_SPOT_IDS, "overflow", () => 0);
  expect(next.lobbySpotId).toBeNull();
});
