import { describe, expect, test } from "bun:test";
import { summarizeRosterUser } from "./UserSettingsRosterMeta.tsx";
import type { UserRecord } from "../../shared/types.ts";

const rooms = [
  { id: "room-a", name: "Alpha" },
  { id: "room-b", name: "Beta" },
];

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "user-1",
    name: "Ada",
    role: "member",
    envFile: null,
    memberPrompt: null,
    language: null,
    slideMode: false,
    allowedRooms: ["room-a", "room-b"],
    hidden: [],
    order: [],
    defaultRoomId: null,
    notifRooms: ["room-a", "room-b"],
    avatarColor: "#58a6ff",
    avatarVariant: "classic",
    createdAt: 1,
    ...overrides,
  };
}

describe("summarizeRosterUser", () => {
  test("shows owner session stats keyed by stable user id", () => {
    const text = summarizeRosterUser(user({ name: "Ada Lovelace" }), rooms, [], [{ userId: "user-1", lastSeenAt: Date.now() - 62_000 }], true);

    expect(text).toBe("Last seen 1m ago • All rooms");
  });

  test("shows online state without session details for non-owners", () => {
    const text = summarizeRosterUser(user({ allowedRooms: ["room-b"] }), rooms, [{ userId: "user-1" }], [], false);

    expect(text).toBe("Online • Beta");
  });

  test("falls back to offline room summary for owners without sessions", () => {
    const text = summarizeRosterUser(user({ allowedRooms: [] }), rooms, [], [], true);

    expect(text).toBe("Offline • No rooms");
  });
});
