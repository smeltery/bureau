import { describe, expect, test } from "bun:test";
import type { AgentInfo } from "../../shared/types.ts";
import { roomActivityDotColor } from "./RoomTabItem.tsx";

function agent(state: AgentInfo["state"]): AgentInfo {
  return { state } as AgentInfo;
}

describe("roomActivityDotColor", () => {
  test("uses green when any inactive-room agent is working", () => {
    expect(roomActivityDotColor([agent("idle"), agent("thinking")], false, false)).toBe("var(--green)");
    expect(roomActivityDotColor([agent("tool_executing")], true, false)).toBe("var(--green)");
  });

  test("uses purple for unread attention without active work", () => {
    expect(roomActivityDotColor([agent("idle")], true, false)).toBe("var(--purple)");
  });

  test("hides for active rooms and quiet inactive rooms", () => {
    expect(roomActivityDotColor([agent("thinking")], true, true)).toBeNull();
    expect(roomActivityDotColor([agent("idle")], false, false)).toBeNull();
  });
});
