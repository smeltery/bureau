import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "./Markdown.tsx";
import { taskChipLabel } from "./task-links.tsx";
import type { TaskItem } from "../../shared/types.ts";

describe("taskChipLabel", () => {
  test("reads id P0: words", () => {
    const task = { id: "abcdef12", title: "Ship the chat chips today please", priority: "P0" } as TaskItem;
    expect(taskChipLabel(task)).toBe("abcdef12 P0: Ship the chat chips…");
  });

  test("omits priority when unset", () => {
    const task = { id: "abcdef12", title: "Short title" } as TaskItem;
    expect(taskChipLabel(task)).toBe("abcdef12: Short title");
  });
});

describe("renderMarkdown task ids", () => {
  test("emits a placeholder span for an 8-hex id", () => {
    const html = renderMarkdown("See abcdef12 for details.");
    expect(html).toContain('data-task-id="abcdef12"');
  });

  test("keeps hex ids inside code literal", () => {
    const html = renderMarkdown("`abcdef12`");
    expect(html).toContain("<code>abcdef12</code>");
    expect(html).not.toContain("data-task-id");
  });
});
