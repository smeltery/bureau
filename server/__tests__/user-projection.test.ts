import { describe, expect, test } from "bun:test";
import type { RoomWire, UserRecord } from "../../shared/types.ts";
import { canSeeRoom, projectRooms } from "../users.ts";

const rooms: RoomWire[] = [
  { id: "r1", name: "Alpha", prompt: null, envFile: null },
  { id: "r2", name: "Beta", prompt: null, envFile: null },
  { id: "r3", name: "Gamma", prompt: null, envFile: null },
];

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "u1",
    name: "User One",
    role: "member",
    envFile: null,
    memberPrompt: null,
    language: null,
    slideMode: false,
    allowedRooms: ["r1", "r2", "r3"],
    hidden: [],
    order: [],
    defaultRoomId: "r1",
    notifRooms: ["r1", "r2", "r3"],
    avatarColor: "#4f8cff",
    avatarVariant: "classic",
    createdAt: 1,
    ...overrides,
  };
}

describe("user room projection", () => {
  test("hidden rooms are omitted from the view but still accessible", () => {
    const record = user({ hidden: ["r2"] });

    expect(projectRooms(record, rooms).map((room) => room.id)).toEqual(["r1", "r3"]);
    expect(canSeeRoom(record, "r2")).toBe(true);
  });

  test("sparse order moves listed visible rooms first and keeps office order for the rest", () => {
    const record = user({ hidden: ["r2"], order: ["r3"] });

    expect(projectRooms(record, rooms).map((room) => room.id)).toEqual(["r3", "r1"]);
  });

  test("owners can hide rooms without losing access", () => {
    const record = user({ role: "owner", allowedRooms: [], hidden: ["r1"], order: ["r3"] });

    expect(projectRooms(record, rooms).map((room) => room.id)).toEqual(["r3", "r2"]);
    expect(canSeeRoom(record, "r1")).toBe(true);
  });
});
