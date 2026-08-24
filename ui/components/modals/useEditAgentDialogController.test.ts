import { describe, expect, test } from "bun:test";
import { canToggleAgentPrivilege, isFormDirty, type EditAgentFormSnapshot } from "./useEditAgentDialogController.ts";

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

function snapshot(overrides: Partial<EditAgentFormSnapshot> = {}): EditAgentFormSnapshot {
  return {
    name: "Scout",
    cwd: "~/dev/bureau",
    outfit: `{"hat":"none"}`,
    customInstructions: "",
    modelFamily: "opus",
    permissionMode: "auto",
    codexSandbox: "workspace-write",
    effort: "xhigh",
    privileged: false,
    ...overrides,
  };
}

describe("isFormDirty", () => {
  test("an untouched form is clean", () => {
    expect(isFormDirty(snapshot(), snapshot())).toBe(false);
  });

  test("any single field edit makes the form dirty", () => {
    const fields: Partial<EditAgentFormSnapshot>[] = [
      { name: "Scout II" },
      { cwd: "~/dev/other" },
      { outfit: `{"hat":"cap"}` },
      { customInstructions: "Always write tests." },
      { modelFamily: "sonnet" },
      { permissionMode: "default" },
      { codexSandbox: "danger-full-access" },
      { effort: "high" },
      { privileged: true },
    ];
    for (const change of fields) {
      expect(isFormDirty(snapshot(), snapshot(change))).toBe(true);
    }
  });

  test("dirtiness is measured against the rendered opening state, not the persisted agent", () => {
    // A spawn dialog opens with a random outfit and an auto-corrected
    // permission mode; those ARE the baseline, so an immediate close is clean.
    const rendered = snapshot({ outfit: `{"hat":"random-roll"}`, permissionMode: "bypassPermissions" });
    expect(isFormDirty(rendered, { ...rendered })).toBe(false);
  });
});
