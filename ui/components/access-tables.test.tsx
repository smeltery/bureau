import { describe, expect, test } from "bun:test";
import { sessionExpiryLines, formatInviteRooms } from "./access-tables.tsx";

const rooms = [
  { id: "room-a", name: "Alpha" },
  { id: "room-b", name: "Beta" },
];

describe("formatInviteRooms", () => {
  test("renders a dash when an invite has no room grants", () => {
    expect(formatInviteRooms({}, rooms)).toBe("—");
    expect(formatInviteRooms({ allowedRooms: [] }, rooms)).toBe("—");
  });

  test("renders granted room names and preserves unknown ids", () => {
    expect(formatInviteRooms({ allowedRooms: ["room-b", "missing"] }, rooms)).toBe("Beta, missing");
  });
});

describe("sessionExpiryLines", () => {
  test("shows both session deadlines as absolute local times", () => {
    expect(
      sessionExpiryLines({
        expiresAt: new Date(2026, 0, 2, 15, 4).getTime(),
        absoluteExpiresAt: new Date(2027, 10, 12, 8, 9).getTime(),
      }),
    ).toEqual([
      {
        label: "Expires after inactivity",
        value: "2026-01-02 15:04 local",
      },
      {
        label: "Expires at the latest",
        value: "2027-11-12 08:09 local",
      },
    ]);
  });
});
