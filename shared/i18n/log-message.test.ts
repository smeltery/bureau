import { expect, test } from "bun:test";
import type { LogEntry } from "../log-types.ts";
import { displayLogContent, logContent, logMessage, logPlural, logParts } from "./log-message.ts";

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

test("nested labels and timestamps render in the reader's language", () => {
  const entry = { kind: "system" as const, ...logContent(logMessage("logs.choice.effortSwitched", { label: logMessage("logs.effort.high") })) };
  expect(entry.content).toBe("Thinking effort set to High. The agent will be notified on its next turn.");
  expect(displayLogContent(entry, "es")).toBe("Esfuerzo de razonamiento establecido en Alto. Se notificará al agente en su próximo turno.");
  const timestamp = Date.UTC(2026, 9, 23, 13, 45);
  const details = { kind: "system" as const, ...logContent(logMessage("logs.choice.sessionDetails", { date: { timestamp }, cwd: "  /tmp/project", branch: logMessage("logs.choice.branchSuffix") })) };
  const date = new Intl.DateTimeFormat("zh", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(timestamp);
  expect(displayLogContent(details, "zh")).toBe(`${date}  /tmp/project  （已分支）`);
});

test("invalid nested values, dates and cycles fall back without partial translation", () => {
  const cycle: Record<string, unknown> = { key: "logs.choice.alreadyUsing" };
  cycle.params = { label: cycle };
  for (const label of [cycle, { timestamp: NaN }, { timestamp: 9e15 }, { timestamp: "yesterday" }, { key: "logs.future" }, Object.create({ key: "logs.interrupted" })]) {
    const entry = { kind: "system", id: "bad", agentId: "test", timestamp: 0, content: "Original", message: { key: "logs.choice.alreadyUsing", params: { label } } } as LogEntry;
    expect(displayLogContent(entry, "ca")).toBe("Original");
  }
});

test("plural log messages select forms by reader locale and preserve counts", () => {
  for (const count of [0, 1, 2]) {
    const entry = { kind: "system" as const, ...logContent(logPlural("logs.command.clearedQueue", count)) };
    expect(displayLogContent(entry, "en")).toContain(`${count} queued message${count === 1 ? "" : "s"}.`);
    expect(displayLogContent(entry, "zh")).toBe(`对话已清除。已丢弃 ${count} 条排队消息。`);
  }
});

test("composed log parts fall back atomically on malformed nested data", () => {
  const entry = { kind: "system" as const, ...logContent(logParts([logMessage("logs.command.cleared"), "\n", "Original text"])) };
  expect(displayLogContent(entry, "ca")).toBe("Conversa esborrada.\nOriginal text");
  const cycle: { parts: unknown[] } = { parts: [] };
  cycle.parts.push(cycle);
  for (const message of [
    { key: "logs.parts", params: { parts: cycle } },
    { key: "logs.parts", params: { parts: { parts: ["Valid", null] } } },
    { key: "logs.command.clearedQueue", count: Infinity },
    { key: "logs.command.clearedQueue", count: "1" },
    { key: "logs.command.clearedQueue" },
    { key: "logs.interrupted", count: 1 },
  ]) {
    expect(displayLogContent({ ...entry, message } as unknown as LogEntry, "es")).toBe(entry.content);
  }
});
