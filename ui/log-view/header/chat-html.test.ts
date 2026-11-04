import { expect, test } from "bun:test";
import type { LogEntry } from "../../../shared/types.ts";
import { chatHtmlDocument, chatHtmlFileName, type ChatHtmlOptions } from "./chat-html.ts";

let seq = 0;
const entry = (kind: LogEntry["kind"], content: string, metadata?: Record<string, unknown>): LogEntry =>
  ({ id: `e${++seq}`, agentId: "a", timestamp: seq, kind, content, ...(metadata ? { metadata } : {}) }) as LogEntry;

const options: ChatHtmlOptions = {
  agentName: "Ada <Lead>",
  viewer: "ana",
  senderLabel: (e) => e.metadata?.username as string,
  language: "en",
  exportedAt: new Date("2026-11-04T10:00:00Z"),
  dateLabel: "Nov 4, 2026",
};

const log: LogEntry[] = [
  entry("user_message", "Is <b>this</b> safe?", { username: "Ana" }),
  entry("tool_call", "Bash", { input: { command: "ls <dir>" } }),
  entry("text", "Yes: **bold**, [docs](https://example.com), [local](/api/files/x), ![shot](/api/uploads/a.png)\n\n<script>alert(1)</script>"),
];

test("the page groups speakers and renders replies as Markdown", () => {
  const html = chatHtmlDocument(log, "everything", options);
  expect(html).toStartWith("<!doctype html>");
  expect(html).toContain("<title>Ada &lt;Lead&gt;</title>");
  expect(html).toContain("<h2>Ana</h2>");
  expect(html).toContain("<h2>Ada &lt;Lead&gt;</h2>");
  expect(html.match(/<section/g)).toHaveLength(2);
  expect(html).toContain("<strong>bold</strong>");
  expect(html).toContain("<summary>Bash</summary><pre>{\n  &quot;command&quot;: &quot;ls &lt;dir&gt;&quot;\n}</pre>");
});

test("the file runs nothing and loads nothing from the office", () => {
  const html = chatHtmlDocument(log, "everything", options);
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  expect(html).toContain("Is &lt;b&gt;this&lt;/b&gt; safe?");
  expect(html).toContain('<a href="https://example.com" target="_blank" rel="noopener noreferrer">docs</a>');
  expect(html).not.toContain("/api/files/x");
  expect(html).not.toContain("<img");
  expect(html).toContain("shot");
  expect(html).toContain("default-src 'none'");
});

test("scopes match the Copy menu's", () => {
  const html = chatHtmlDocument(log, "messages", options);
  expect(html).not.toContain("<details");
});

test("the file is named after the agent and the day", () => {
  expect(chatHtmlFileName("Ada <Lead>", options.exportedAt)).toBe("ada-lead-2026-11-04.html");
  expect(chatHtmlFileName("  !!  ", options.exportedAt)).toBe("chat-2026-11-04.html");
});
