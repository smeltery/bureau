import { describe, expect, test } from "bun:test";
import { DEFAULT_ROOM_SKIN, effectiveRoomSkin, isRoomSkin, parseRoomSkin, SELECTABLE_ROOM_SKIN_IDS } from "./room-skins.ts";

describe("room skins", () => {
  test("defaults to office", () => {
    expect(effectiveRoomSkin()).toBe(DEFAULT_ROOM_SKIN);
    expect(effectiveRoomSkin({ skin: null })).toBe("office");
    expect(effectiveRoomSkin({ skin: "nope" as never })).toBe("office");
  });

  test("accepts known ids", () => {
    expect(isRoomSkin("hospital")).toBe(true);
    expect(effectiveRoomSkin({ skin: "hospital" })).toBe("hospital");
    expect(parseRoomSkin("hospital")).toEqual({ ok: true, skin: "hospital" });
    expect(parseRoomSkin(null)).toEqual({ ok: true, skin: null });
  });

  test("picker offers every shipped look", () => {
    expect([...SELECTABLE_ROOM_SKIN_IDS]).toEqual(["office", "hospital"]);
  });
});
