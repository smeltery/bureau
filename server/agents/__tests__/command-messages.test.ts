import { expect, test } from "bun:test";
import { commands, unsupportedMessage } from "../commands.ts";
import { commandDescription, unsupportedLogMessage } from "../conversation/command-messages.ts";
import { displayLogContent, logContent } from "../../../shared/i18n/log-message.ts";

test("every registry description has a matching translation without changing English", () => {
  for (const [name, cfg] of Object.entries(commands)) {
    if (!cfg.description) continue;
    const message = commandDescription(name, cfg.description);
    expect(typeof message, name).toBe("object");
    const entry = { kind: "system" as const, ...logContent(message as ReturnType<typeof unsupportedLogMessage>) };
    expect(entry.content, name).toBe(cfg.description);
    for (const language of ["es", "ca", "zh"] as const) expect(displayLogContent(entry, language), name).not.toBe(cfg.description);
  }
});

test("all unavailable-command replies preserve English and translate per reader", () => {
  for (const [name, cfg] of Object.entries(commands)) {
    if (cfg.supported) continue;
    const message = unsupportedLogMessage(name);
    expect(typeof message, name).toBe("object");
    const entry = { kind: "system" as const, ...logContent(message) };
    expect(entry.content, name).toBe(unsupportedMessage(name));
    for (const language of ["es", "ca", "zh"] as const) expect(displayLogContent(entry, language), name).not.toBe(entry.content);
  }
});

test("unknown and changed descriptions remain literal", () => {
  expect(commandDescription("my-skill", "Custom words")).toBe("Custom words");
  expect(commandDescription("help", "Updated description")).toBe("Updated description");
  expect(commandDescription("help", undefined)).toBeUndefined();
  expect(commandDescription("bureauDiff", commands["bureau-diff"].description)).toBe(commands["bureau-diff"].description);
  const entry = { kind: "system" as const, ...logContent(unsupportedLogMessage("unknown")) };
  expect(displayLogContent(entry, "es")).toBe("`/unknown` no está disponible en Bureau.");
});
