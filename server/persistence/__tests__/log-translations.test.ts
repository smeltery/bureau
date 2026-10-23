import { afterEach, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { displayLogContent, logMessage } from "../../../shared/i18n/log-message.ts";
import { addLogEntry, emitEphemeralLog, logCache } from "../../agents/state.ts";
import { appendLog, loadLog } from "../logs/logs.ts";
import { appendRunLog, loadRunLog } from "../cronjob-run-sessions.ts";
import { BUREAU_DIR } from "../paths.ts";

afterEach(() => logCache.delete("translation-agent"));

test("cached and persisted translations redact parameters before readers see them", () => {
  const secret = "sk-proj-" + "Q".repeat(24);
  addLogEntry("translation-agent", "error", logMessage("logs.resumeFailed", { error: secret }));
  const entry = logCache.get("translation-agent")![0];
  expect(entry.message?.params?.error).toBe("sk-proj-...REDACTED");
  expect(entry.content).toBe("Failed to resume: sk-proj-...REDACTED");
  appendLog("translation-agent", "translated-session", entry);
  appendRunLog("translation-job", "translation-run", "translated-session", entry);
  for (const restored of [loadLog("translation-agent", "translated-session")[0], loadRunLog("translation-job", "translation-run", "translated-session")[0]]) {
    expect(restored).toEqual(entry);
    expect(displayLogContent(restored, "es")).toBe("No se pudo reanudar: sk-proj-...REDACTED");
  }
  const raw = readFileSync(join(BUREAU_DIR, "logs", "translation-agent", "translated-session.jsonl"), "utf8");
  expect(raw).not.toContain(secret);
});

test("ephemeral replies carry the same reader translation payload", () => {
  emitEphemeralLog("translation-agent", "system", logMessage("logs.resumed", { topic: "Widget" }));
  const entry = logCache.get("translation-agent")![0];
  expect(entry.ephemeral).toBe(true);
  expect(entry.content).toBe("Resumed session: Widget");
  expect(displayLogContent(entry, "zh")).toBe("已恢复会话：Widget");
});

test("nested choice translation parameters are redacted before persistence", () => {
  const secret = "sk-proj-" + "R".repeat(24);
  addLogEntry("translation-agent", "system", "Choices", {
    choicePrompt: {
      kind: "resume",
      title: "Resume",
      instruction: "Choose",
      choices: [{ value: "session", label: "Topic", description: secret, descriptionMessage: logMessage("logs.choice.alreadyUsing", { label: logMessage("logs.resumed", { topic: secret }) }) }],
    },
  });
  const entry = logCache.get("translation-agent")![0];
  appendLog("translation-agent", "nested-choice", entry);
  const restored = loadLog("translation-agent", "nested-choice")[0];
  expect(JSON.stringify(restored)).not.toContain(secret);
  expect(JSON.stringify(restored)).toContain("sk-proj-...REDACTED");
});
