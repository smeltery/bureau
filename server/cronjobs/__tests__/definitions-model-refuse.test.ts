import { afterEach, describe, expect, test } from "bun:test";
import { InvalidModelFamilyError } from "../../agent-validators.ts";
import * as CronjobManager from "../index.ts";

afterEach(() => {
  for (const job of CronjobManager.listCronjobs()) CronjobManager.deleteCronjob(job.id);
});

describe("cronjob model family refuse", () => {
  test("create refuses a Claude family on a Codex cronjob before persist", () => {
    expect(() =>
      CronjobManager.addCronjob({
        name: "Bad",
        schedule: { type: "daily", hour: 9, minute: 0 },
        prompt: "Check",
        cwd: process.cwd(),
        agentType: "codex",
        modelFamily: "opus",
        effort: "medium",
        permissionMode: "never",
        username: "Owner",
      }),
    ).toThrow(InvalidModelFamilyError);
    expect(CronjobManager.listCronjobs()).toEqual([]);
  });

  test("update refuses Claude-shaped Codex models and keeps the prior family", () => {
    const job = CronjobManager.addCronjob({
      name: "Codex shape",
      schedule: { type: "daily", hour: 9, minute: 0 },
      prompt: "Check",
      cwd: process.cwd(),
      agentType: "codex",
      modelFamily: "gpt-7-x",
      effort: "medium",
      permissionMode: "never",
      username: "Owner",
      userId: "owner-1",
    });
    expect(() => CronjobManager.updateCronjob(job.id, { modelFamily: "fable-5" })).toThrow(InvalidModelFamilyError);
    expect(CronjobManager.listCronjobs().find((j) => j.id === job.id)?.modelFamily).toBe("gpt-7-x");
  });

  test("update refuses an OpenCode engine switch without a provider/model", () => {
    const job = CronjobManager.addCronjob({
      name: "OpenCode switch",
      schedule: { type: "daily", hour: 9, minute: 0 },
      prompt: "Check",
      cwd: process.cwd(),
      agentType: "claude",
      modelFamily: "opus",
      effort: "high",
      permissionMode: "bypassPermissions",
      username: "Owner",
      userId: "owner-1",
    });
    expect(() => CronjobManager.updateCronjob(job.id, { agentType: "opencode" })).toThrow(InvalidModelFamilyError);
    expect(CronjobManager.listCronjobs().find((j) => j.id === job.id)).toMatchObject({ agentType: "claude", modelFamily: "opus" });
  });

  test("create accepts an unknown Codex-shaped slug", () => {
    const job = CronjobManager.addCronjob({
      name: "Ok",
      schedule: { type: "daily", hour: 9, minute: 0 },
      prompt: "Check",
      cwd: process.cwd(),
      agentType: "codex",
      modelFamily: "gpt-7-x",
      effort: "medium",
      permissionMode: "never",
      username: "Owner",
    });
    expect(job.modelFamily).toBe("gpt-7-x");
  });
});
