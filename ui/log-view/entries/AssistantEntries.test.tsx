import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AssistantText, shouldCollapseAssistantText } from "./AssistantEntries.tsx";

describe("AssistantText", () => {
  test("leaves short messages fully expanded", () => {
    expect(shouldCollapseAssistantText("Short answer.")).toBe(false);

    const html = renderToStaticMarkup(createElement(AssistantText, { content: "Short answer." }));

    expect(html).not.toContain("Show more");
    expect(html).not.toContain("max-height");
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
