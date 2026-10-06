import { describe, expect, it } from "bun:test";
import type { RoomWire } from "../shared/types.ts";
import { applyRoomClose, resolveSelectedRoomId, roomIndexById, roomsInViewerOrder } from "./roomSelection.ts";

function room(id: string): RoomWire {
  return { id, name: id.toUpperCase(), prompt: null, envFile: null };
}

const A = room("a");
const B = room("b");
const C = room("c");

describe("resolveSelectedRoomId", () => {
  it("keeps the current selection when it still exists", () => {
    expect(resolveSelectedRoomId([A, B, C], "b")).toBe("b");
  });

  it("prefers a present default room", () => {
    expect(resolveSelectedRoomId([A, B, C], null, "c")).toBe("c");
  });

  it("ignores a missing default room", () => {
    expect(resolveSelectedRoomId([A, B, C], "a", "missing")).toBe("a");
  });

  it("falls back to the first room when current is missing", () => {
    expect(resolveSelectedRoomId([A, B, C], "missing")).toBe("a");
  });

  it("returns null when there are no rooms", () => {
    expect(resolveSelectedRoomId([], "a", "b")).toBe(null);
  });
});

describe("applyRoomClose", () => {
  it("no-ops when the closed room is missing", () => {
    expect(applyRoomClose([A, B, C], "missing", "b")).toBe(null);
  });

  it("preserves selection when closing a different room before current", () => {
    const result = applyRoomClose([A, B, C], "a", "c");

    expect(result?.currentRoomId).toBe("c");
    expect(result?.rooms.map((item) => item.id)).toEqual(["b", "c"]);
  });

  it("preserves selection when closing a different room after current", () => {
    const result = applyRoomClose([A, B, C], "c", "a");

    expect(result?.currentRoomId).toBe("a");
    expect(result?.rooms.map((item) => item.id)).toEqual(["a", "b"]);
  });

  it("selects the room taking the current room's slot", () => {
    const result = applyRoomClose([A, B, C], "b", "b");

    expect(result?.currentRoomId).toBe("c");
    expect(result?.rooms.map((item) => item.id)).toEqual(["a", "c"]);
  });

  it("selects the new last room when closing the selected last room", () => {
    const result = applyRoomClose([A, B, C], "c", "c");

    expect(result?.currentRoomId).toBe("b");
    expect(result?.rooms.map((item) => item.id)).toEqual(["a", "b"]);
  });
});

describe("roomIndexById", () => {
  it("returns the matching room index", () => {
    expect(roomIndexById([A, B, C], "c")).toBe(2);
  });

  it("falls back to zero for null or missing ids", () => {
    expect(roomIndexById([A, B, C], null)).toBe(0);
    expect(roomIndexById([A, B, C], "missing")).toBe(0);
  });
});

describe("roomsInViewerOrder", () => {
  it("uses the viewer's tabs first and keeps hidden rooms in office order", () => {
    const available = [A, B, C];
    expect(roomsInViewerOrder(available, [C, A])).toEqual([C, A, B]);
    expect(available).toEqual([A, B, C]);
  });

  it("ignores unavailable and duplicate tabs without dropping accessible rooms", () => {
    expect(roomsInViewerOrder([A, B], [C, B, B])).toEqual([B, A]);
    expect(roomsInViewerOrder([A, B], [])).toEqual([A, B]);
  });
});
