import { describe, expect, test } from "bun:test";
import { canToggleAgentPrivilege } from "./useEditAgentDialogController.ts";

describe("canToggleAgentPrivilege", () => {
  test("allows owners and the spawning user to manage existing agents", () => {
    expect(canToggleAgentPrivilege(false, { role: "owner", userId: "owner-1" }, { userId: "member-1" })).toBe(true);
    expect(canToggleAgentPrivilege(false, { role: "member", userId: "member-1" }, { userId: "member-1" })).toBe(true);
  });

  test("hides privilege controls for spawns, anonymous sessions, and other members", () => {
    expect(canToggleAgentPrivilege(true, { role: "owner", userId: "owner-1" }, undefined)).toBe(false);
    expect(canToggleAgentPrivilege(false, null, { userId: "member-1" })).toBe(false);
    expect(canToggleAgentPrivilege(false, { role: "member", userId: "other-member" }, { userId: "member-1" })).toBe(false);
  });
});
