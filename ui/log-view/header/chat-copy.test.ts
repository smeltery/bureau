import { expect, test } from "bun:test";
import type { LogEntry } from "../../../shared/types.ts";
import { chatCopyEntries, chatCopyText, markdownToPlainText, type ChatCopyOptions } from "./chat-copy.ts";

let seq = 0;
const entry = (kind: LogEntry["kind"], content: string, metadata?: Record<string, unknown>): LogEntry =>
  ({ id: `e${++seq}`, agentId: "a", timestamp: seq, kind, content, ...(metadata ? { metadata } : {}) }) as LogEntry;

const log: LogEntry[] = [
  entry("user_message", "Ship *it*", { username: "Ana" }),
  entry("tool_call", "Bash", { input: { command: "ls" } }),
  entry("text", "Done: **3** files, see [docs](https://example.com)."),
  entry("user_message", "Status?", { username: "Ben" }),
  entry("user_message", "Ping from a peer", { username: "Ana", sender_agent_name: "Scout" }),
  entry("text", "All green."),
];

const options = (overrides: Partial<ChatCopyOptions> = {}): ChatCopyOptions => ({
  format: "markdown",
  agentName: "Ada",
  viewer: "ana",
  senderLabel: (e) => (e.metadata?.sender_agent_name as string | undefined) ?? (e.metadata?.username as string),
  ...overrides,
});

test("each scope keeps the entries it names", () => {
  const ids = (scope: Parameters<typeof chatCopyEntries>[1], viewer: string | null = "ana") => chatCopyEntries(log, scope, viewer).map((e) => e.content);
  expect(ids("everything")).toHaveLength(log.length);
  expect(ids("messages")).not.toContain("Bash");
  expect(ids("messages")).toHaveLength(5);
  expect(ids("mine")).toEqual(["Ship *it*"]);
  expect(ids("mine", null)).toEqual(["Ship *it*", "Status?"]);
  expect(ids("lastExchange")).toEqual(["Ping from a peer", "All green."]);
});

test("Markdown names each speaker run in bold and keeps replies as written", () => {
  const text = chatCopyText(log.slice(0, 3), "everything", options());
  expect(text).toBe('**Ana:**\n\nShip *it*\n\n**Ada:**\n\n**Bash**\n{\n  "command": "ls"\n}\n\nDone: **3** files, see [docs](https://example.com).');
});

test("plain text strips reply Markdown but keeps member messages as typed", () => {
  const text = chatCopyText(log.slice(0, 3), "messages", options({ format: "plain" }));
  expect(text).toBe("Ana:\nShip *it*\n\nAda:\nDone: 3 files, see docs (https://example.com).");
});

test("plain text keeps list markers, code and table cells", () => {
  expect(markdownToPlainText("1. **one**\n2. `two`\n\n```ts\nconst x = 1;\n```\n\n| a | b |\n|---|---|\n| 1 | 2 |")).toBe("1. one\n2. two\n\nconst x = 1;\n\na | b\n1 | 2");
  expect(markdownToPlainText("Tom &amp; Jerry")).toBe("Tom & Jerry");
});
