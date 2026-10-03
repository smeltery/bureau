import { describe, expect, test } from "bun:test";
import {
  DEFAULT_ROOM_DECOR,
  DEFAULT_ROOM_SKIN,
  ROOM_DECOR_IDS,
  SELECTABLE_ROOM_SKIN_IDS,
  effectiveRoomDecor,
  effectiveRoomSkin,
  isRoomDecor,
  isRoomSkin,
  parseRoomDecor,
  parseRoomSkin,
} from "./room-skins.ts";

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

describe("room decor", () => {
  test("defaults to standard", () => {
    expect(effectiveRoomDecor()).toBe(DEFAULT_ROOM_DECOR);
    expect(effectiveRoomDecor({ decor: null })).toBe("standard");
    expect(effectiveRoomDecor({ decor: "nope" as never })).toBe("standard");
  });

  test("accepts known ids", () => {
    expect(isRoomDecor("minimal")).toBe(true);
    expect(isRoomDecor("lively")).toBe(true);
    expect(parseRoomDecor("lively")).toEqual({ ok: true, decor: "lively" });
    expect(parseRoomDecor(null)).toEqual({ ok: true, decor: null });
  });

  test("lists every shipped density", () => {
    expect([...ROOM_DECOR_IDS]).toEqual(["minimal", "standard", "lively"]);
  });
});
