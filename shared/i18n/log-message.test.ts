import { expect, test } from "bun:test";
import type { LogEntry } from "../log-types.ts";
import { displayLogContent, logContent, logMessage } from "./log-message.ts";

test("one stored lifecycle entry renders independently for each reader", () => {
  const entry = { kind: "system" as const, ...logContent(logMessage("logs.newConversation")) };
  expect(displayLogContent(entry, "es")).toBe("Se ha iniciado una conversación nueva.");
  expect(displayLogContent(entry, "ca")).toBe("S’ha iniciat una conversa nova.");
  expect(displayLogContent(entry, "zh")).toBe("已开始新对话。");
  expect(displayLogContent(entry, "en")).toBe("New conversation started.");
  expect(entry.content).toBe("New conversation started.");
});

test("parameters remain literal and provider error details are preserved", () => {
  const entry = { kind: "error" as const, ...logContent(logMessage("logs.resumeFailed", { error: "Unknown {cwd}: /tmp/project" })) };
  expect(entry.content).toBe("Failed to resume: Unknown {cwd}: /tmp/project");
  expect(displayLogContent(entry, "es")).toBe("No se pudo reanudar: Unknown {cwd}: /tmp/project");
});

test("old, unknown and malformed payloads retain their readable content", () => {
  for (const message of [
    undefined,
    null,
    [],
    "logs.interrupted",
    {},
    { key: "logs.future" },
    { key: "toString" },
    { key: "access.title" },
    { key: "logs.resumed" },
    { key: "logs.resumed", params: { topic: {} } },
    { key: "logs.resumed", params: { topic: Infinity } },
    { key: "logs.resumed", params: Object.create({ topic: "inherited" }) },
  ]) {
    const entry = { kind: "system", content: "Original message", message } as LogEntry;
    expect(displayLogContent(entry, "es")).toBe("Original message");
  }
});

test("human, model and tool text cannot opt into translation", () => {
  for (const kind of ["user_message", "text", "thinking", "tool_call", "tool_result", "api_token_outbound"] as const) {
    const entry = { kind, content: "Agent interrupted.", message: logMessage("logs.interrupted") };
    expect(displayLogContent(entry, "es")).toBe(entry.content);
  }
  expect(logContent("Agent interrupted.")).toEqual({ content: "Agent interrupted." });
});

test("invalid producer payloads fail explicitly", () => {
  expect(() => logContent({ key: "logs.resumed" })).toThrow("Invalid structured log message");
});
