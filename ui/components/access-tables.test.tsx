import { describe, expect, test } from "bun:test";
import { formatInviteRooms } from "./access-tables.tsx";

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
