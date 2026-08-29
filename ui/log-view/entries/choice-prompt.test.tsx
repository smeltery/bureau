import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ChoicePromptCard } from "./AssistantEntries.tsx";

describe("ChoicePromptCard", () => {
  test("renders each choice with its typed position", () => {
    const html = renderToStaticMarkup(
      createElement(ChoicePromptCard, {
        prompt: {
          kind: "model",
          title: "Switch model",
          instruction: "Reply with a number to switch, or anything else to cancel.",
          choices: [
            { value: "opus", label: "Opus" },
            { value: "fable", label: "Fable", current: true },
            { value: "sonnet", label: "Sonnet" },
          ],
        },
      }),
    );

    expect(html).toContain("1.");
    expect(html).toContain("Opus");
    expect(html).toContain("2.");
    expect(html).toContain("Fable (current)");
    expect(html).toContain("3.");
    expect(html).toContain("Sonnet");
  });
});
