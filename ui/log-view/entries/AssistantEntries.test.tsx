import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantText, shouldCollapseAssistantText } from "./AssistantEntries.tsx";

describe("AssistantText", () => {
  test("leaves short messages fully expanded", () => {
    expect(shouldCollapseAssistantText("Short answer.")).toBe(false);

    const html = renderToStaticMarkup(createElement(AssistantText, { content: "Short answer.", timestamp: Date.UTC(2026, 8, 12, 12, 0) }));

    expect(html).not.toContain("Show more");
    expect(html).not.toContain("max-height");
    expect(html).toContain("data-message-timestamp");
    expect(html).toContain("2026-09-12T12:00:00.000Z");
  });

  test("collapses long messages behind an explicit control", () => {
    const content = Array.from({ length: 50 }, (_, index) => `Line ${index + 1}`).join("\n");

    expect(shouldCollapseAssistantText(content)).toBe(true);

    const html = renderToStaticMarkup(createElement(AssistantText, { content }));

    expect(html).toContain("Show more");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("max-height:360px");
  });
});
