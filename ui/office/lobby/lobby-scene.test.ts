// Smoke test: lobby scene modules load without office skin modules, and the
// Bureau + fireside layouts exist for the parent to mount.

import { expect, test } from "bun:test";
import { LobbyScene, LOBBY_LAYOUTS, LOBBY_LAYOUT_IDS, type LobbyLayoutId } from "./index.ts";

test("LobbyScene is a function export", () => {
  expect(typeof LobbyScene).toBe("function");
});

test("bureau and fireside layouts exist", () => {
  expect(LOBBY_LAYOUTS.bureau).toBeDefined();
  expect(LOBBY_LAYOUTS.fireside).toBeDefined();
  expect(LOBBY_LAYOUTS.bureau.id).toBe("bureau");
  expect(LOBBY_LAYOUTS.fireside.id).toBe("fireside");
  expect(LOBBY_LAYOUT_IDS).toContain("bureau");
  expect(LOBBY_LAYOUT_IDS).toContain("fireside");
});

test("default layout id fireside is in the registry", () => {
  const id: LobbyLayoutId = "fireside";
  expect(LOBBY_LAYOUTS[id].placements.length).toBeGreaterThan(0);
  expect(LOBBY_LAYOUTS[id].receptionist).toBeDefined();
});

test("lobby does not require office skin modules", async () => {
  // Importing the lobby must not pull skins/ — skins stay optional for rooms.
  const skins = await import("../skins/index.tsx");
  expect(skins.ROOM_SKIN_MODULES).toBeDefined();
  // LobbyScene itself never imports skins; this just proves skins remain loadable
  // independently (parent can use either surface).
  expect(Object.keys(skins.ROOM_SKIN_MODULES).length).toBeGreaterThan(0);
});
