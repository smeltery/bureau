import { describe, expect, test } from "bun:test";
import {
  agentSpawnedPermissions,
  assertModelFamilyForAgentType,
  InvalidModelFamilyError,
  modelFamilyMismatchError,
  resolveInteractiveModelSelection,
  validateCronjobPermissionMode,
} from "../agent-validators.ts";
import { CODEX_MODELS, knownModelFamiliesFor, MODEL_FAMILIES, type AgentInfo } from "../../shared/types.ts";

describe("validateCronjobPermissionMode", () => {
  test("keeps the unattended cron mode", () => {
    expect(validateCronjobPermissionMode("claude", "bypassPermissions")).toBe("bypassPermissions");
  });

  test("coerces legacy auto cron records to bypass", () => {
    expect(validateCronjobPermissionMode("claude", "auto")).toBe("bypassPermissions");
  });

  test("coerces unknown cron modes to bypass", () => {
    expect(validateCronjobPermissionMode("claude", "default")).toBe("bypassPermissions");
    expect(validateCronjobPermissionMode("claude", undefined)).toBe("bypassPermissions");
  });

  test("uses never for unattended codex cron records", () => {
    expect(validateCronjobPermissionMode("codex", "on-request")).toBe("never");
    expect(validateCronjobPermissionMode("codex", undefined)).toBe("never");
  });

  test("uses bypass for unattended opencode cron records", () => {
    expect(validateCronjobPermissionMode("opencode", "default")).toBe("bypassPermissions");
    expect(validateCronjobPermissionMode("opencode", undefined)).toBe("bypassPermissions");
  });
});

describe("interactive model selection validation", () => {
  test("rejects a Claude-shaped model for Codex", () => {
    const result = resolveInteractiveModelSelection("codex", "fable-5", "fable-5");
    expect(result.error).toContain('"fable-5"');
  });

  test("accepts unknown Codex-shaped slugs but rejects Claude shapes case-insensitively", () => {
    for (const model of ["gpt-5.6-sol", "gpt-7-x"]) {
      expect(resolveInteractiveModelSelection("codex", model, model).error).toBeNull();
    }
    for (const model of ["claude-fable-5-1", "fable-5", "Opus-4"]) {
      expect(resolveInteractiveModelSelection("codex", model, model).error).not.toBeNull();
    }
  });

  test("requires a concrete model assertion to agree with its family", () => {
    expect(resolveInteractiveModelSelection("claude", "fable", "claude-fable-5").error).toContain('resolves to model "claude-fable-5-1"');
    expect(resolveInteractiveModelSelection("claude", "fable", "claude-fable-5-1").error).toBeNull();
    expect(resolveInteractiveModelSelection("codex", "gpt-5.6-sol", "gpt-5.6-sol").error).toBeNull();
  });

  test("validates OpenCode provider/model IDs", () => {
    expect(modelFamilyMismatchError("opencode", "provider/model")).toBeNull();
    expect(modelFamilyMismatchError("opencode", "opus")).toContain("provider/model");
    expect(modelFamilyMismatchError("opencode", undefined)).toContain("requires");
    expect(modelFamilyMismatchError("opencode", "opencode/fake")).toContain("not available");
  });

  test("derives a family from model-only input", () => {
    expect(resolveInteractiveModelSelection("claude", undefined, "claude-fable-5-1")).toEqual({ modelFamily: "fable", error: null });
    expect(resolveInteractiveModelSelection("codex", undefined, "gpt-7-x")).toEqual({ modelFamily: "gpt-7-x", error: null });
    expect(resolveInteractiveModelSelection("opencode", undefined, "provider/runtime-model")).toEqual({ modelFamily: "provider/runtime-model", error: null });
  });

  test("defaults sparse Claude and Codex input without preserving another backend's family", () => {
    expect(resolveInteractiveModelSelection("claude", undefined, undefined)).toEqual({ modelFamily: "opus", error: null });
    expect(resolveInteractiveModelSelection("codex", undefined, undefined)).toEqual({ modelFamily: "gpt-5.6-sol", error: null });
    expect(resolveInteractiveModelSelection("opencode", undefined, undefined).error).toContain("requires");
  });

  test("uses a short Codex refuse tone for Claude-shaped names", () => {
    expect(modelFamilyMismatchError("codex", "opus")).toBe('"opus" is not a Codex model.');
    expect(modelFamilyMismatchError("codex", "fable-5")).toBe('"fable-5" is not a Codex model.');
  });
});

describe("knownModelFamiliesFor", () => {
  test("lists Claude families and Codex slugs, and leaves OpenCode to discovery", () => {
    expect(knownModelFamiliesFor("claude")).toEqual(MODEL_FAMILIES.map((m) => m.family));
    expect(knownModelFamiliesFor("codex")).toEqual(CODEX_MODELS.map((m) => m.value));
    expect(knownModelFamiliesFor("opencode")).toBeNull();
  });
});

describe("assertModelFamilyForAgentType", () => {
  test("throws InvalidModelFamilyError for a Claude family on Codex", () => {
    expect(() => assertModelFamilyForAgentType("codex", "opus")).toThrow(InvalidModelFamilyError);
    try {
      assertModelFamilyForAgentType("codex", "opus");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidModelFamilyError);
      expect((err as InvalidModelFamilyError).message).toBe('"opus" is not a Codex model.');
      expect((err as InvalidModelFamilyError).code).toBe("invalid_model_family");
    }
  });

  test("allows a well-formed OpenCode provider/model and refuses missing ones", () => {
    expect(() => assertModelFamilyForAgentType("opencode", "provider/model")).not.toThrow();
    expect(() => assertModelFamilyForAgentType("opencode", undefined)).toThrow(InvalidModelFamilyError);
  });
});

function spawner(fields: Partial<AgentInfo>): AgentInfo {
  return { agentType: "claude", permissionMode: "default", ...fields } as AgentInfo;
}

describe("agentSpawnedPermissions", () => {
  test("a prompting spawner hands its child the engine's unattended mode", () => {
    expect(agentSpawnedPermissions(spawner({ permissionMode: "auto" }), "claude")).toEqual({ permissionMode: "bypassPermissions" });
    expect(agentSpawnedPermissions(spawner({ permissionMode: "acceptEdits" }), "codex")).toEqual({ permissionMode: "never", codexSandbox: "danger-full-access" });
    expect(agentSpawnedPermissions(spawner({ permissionMode: "default" }), "opencode")).toEqual({ permissionMode: "bypassPermissions" });
  });

  test("a never-prompting spawner of the same engine passes its own mode on", () => {
    const codex = spawner({ agentType: "codex", permissionMode: "never", codexSandbox: "workspace-write" });
    expect(agentSpawnedPermissions(codex, "codex")).toEqual({ permissionMode: "never", codexSandbox: "workspace-write" });
  });

  test("a never-prompting spawner of another engine maps to the child's unattended mode", () => {
    const codex = spawner({ agentType: "codex", permissionMode: "never", codexSandbox: "read-only" });
    expect(agentSpawnedPermissions(codex, "claude")).toEqual({ permissionMode: "bypassPermissions" });
  });

  test("an unknown spawner still gets an unattended child", () => {
    expect(agentSpawnedPermissions(undefined, "claude")).toEqual({ permissionMode: "bypassPermissions" });
  });
});
