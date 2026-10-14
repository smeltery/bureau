import { expect, test } from "bun:test";
import { armSettingsNotice, renderSettingsNotice } from "./settings-notice.ts";
import type { ManagedAgent } from "../state-types.ts";
import { stripPluginPrefix, formatSettingsNoticeBlock, formatWakeNoticeBlock } from "../../plugins/plugin-prefix.ts";

test("settings edits coalesce, discard reversions and retain interrupted work", () => {
  const managed = { info: { modelFamily: "sonnet", effort: "high", cwd: "/work" } } as ManagedAgent;
  let before = { ...managed.info };
  managed.info.modelFamily = "opus";
  armSettingsNotice(managed, before, "Alex", true);
  before = { ...managed.info };
  managed.info.modelFamily = "haiku";
  armSettingsNotice(managed, before, "Sam", false);
  expect(managed.settingsNotice?.changes.modelFamily).toEqual({ from: "sonnet", to: "haiku" });
  expect(managed.settingsNotice?.actors).toEqual(["Alex", "Sam"]);
  const text = renderSettingsNotice(managed.settingsNotice!, managed.info);
  expect(text).toContain("Alex, Sam");
  expect(text).toContain("verify their effects");
  before = { ...managed.info };
  managed.info.modelFamily = "sonnet";
  armSettingsNotice(managed, before, "Alex", false);
  expect(managed.settingsNotice?.changes).toEqual({});
  expect(managed.settingsNotice?.interrupted).toBe(true);
  managed.settingsNotice = null;
  before = { ...managed.info };
  managed.info.effort = "low";
  armSettingsNotice(managed, before, "Alex", false);
  before = { ...managed.info };
  managed.info.effort = "high";
  armSettingsNotice(managed, before, "Alex", false);
  expect(managed.settingsNotice).toBeNull();
});

test("edit matching strips settings notices with or without a wake notice", () => {
  const text = `${formatSettingsNoticeBlock("Model changed.")}\n\nContinue.`;
  expect(stripPluginPrefix(text)).toBe("Continue.");
  expect(stripPluginPrefix(`${formatWakeNoticeBlock("Restarted.")}\n\n${text}`)).toBe("Continue.");
});
