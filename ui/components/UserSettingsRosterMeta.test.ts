import { describe, expect, test } from "bun:test";
import { summarizeRosterUser } from "./UserSettingsRosterMeta.tsx";
import type { UserRecord } from "../../shared/types.ts";
import { translatorFor } from "../../shared/i18n/translate.ts";

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

  test("flags a member who has never signed in", () => {
    expect(summarizeRosterUser(user({ pendingSignIn: true }), rooms, [], [], true)).toBe("Never signed in • All rooms");
    expect(summarizeRosterUser(user({ pendingSignIn: true }), rooms, [{ userId: "user-1" }], [], false)).toBe("Online • All rooms");
  });

  test("localizes roster state and time without exposing hidden session details", () => {
    for (const language of ["en", "es", "ca", "zh"] as const) {
      const translator = translatorFor(language);
      const { t, tn } = translator;
      const member = user({ allowedRooms: ["room-b"] });
      const sessions = [{ userId: member.id, lastSeenAt: Date.now() - 62_000 }];
      expect(summarizeRosterUser(member, rooms, [], sessions, false, translator)).toBe("Beta");
      expect(summarizeRosterUser(member, rooms, [], sessions, true, translator)).toBe(t("profile.lastSeen", { time: t("profile.minutesAgo", { count: 1 }), rooms: "Beta" }));
      expect(summarizeRosterUser(member, rooms, [{ userId: member.id }], [], true, translator)).toBe(tn("profile.active", 1, { rooms: "Beta" }));
      expect(summarizeRosterUser(member, rooms, [{ userId: member.id }], [...sessions, ...sessions], true, translator)).toBe(tn("profile.active", 2, { rooms: "Beta" }));
      expect(summarizeRosterUser(user({ pendingSignIn: true }), rooms, [], [], true, translator)).toBe(t("profile.neverSignedIn", { rooms: t("profile.allRooms") }));
      expect(summarizeRosterUser(user({ allowedRooms: [] }), rooms, [], [], true, translator)).toBe(t("profile.offline", { rooms: t("profile.noRooms") }));
    }
  });
});
