import { describe, expect, test } from "bun:test";
import type { UserRecord } from "../../shared/types.ts";
import { recoveryInviteUserOptions } from "./RecoveryInviteForm.tsx";

function user(overrides: Partial<UserRecord> = {}): UserRecord {
  return {
    id: "user-1",
    name: "Ada",
    role: "member",
    envFile: null,
    memberPrompt: null,
    language: null,
    slideMode: false,
    allowedRooms: [],
    hidden: [],
    order: [],
    defaultRoomId: null,
    notifRooms: [],
    avatarColor: "#58a6ff",
    avatarVariant: "classic",
    createdAt: 1,
    ...overrides,
  };
}

describe("recoveryInviteUserOptions", () => {
  test("sorts existing users by display name", () => {
    const users = new Map([
      ["marc", user({ id: "user-2", name: "Marc" })],
      ["ada", user({ id: "user-1", name: "Ada" })],
      ["grace", user({ id: "user-3", name: "Grace" })],
    ]);

    expect(recoveryInviteUserOptions(users).map((u) => u.name)).toEqual(["Ada", "Grace", "Marc"]);
  });
});
