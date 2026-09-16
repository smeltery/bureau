import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HelpCard, PromptInspectCard } from "./HelpCard.tsx";
import { LogEntryCard } from "./index.tsx";

describe("HelpCard", () => {
  test("renders a compact card with Show help affordance", () => {
    const html = renderToStaticMarkup(createElement(HelpCard, { header: "**Help**", helpContent: "## Commands\n`/help`" }));
    expect(html).toContain("Help");
    expect(html).toContain("Show help");
    expect(html).not.toContain("## Commands");
  });
});

describe("PromptInspectCard", () => {
  test("renders a compact card for cronjob prompt metadata", () => {
    const html = renderToStaticMarkup(
      createElement(PromptInspectCard, {
        header: '**System prompt for "Nightly check"**',
        content: "system\n\n----\nFirst user message:\n\nCheck",
        actionLabel: "Show prompt",
        modalTitle: "Nightly check",
        renderAs: "plaintext",
      }),
    );
    expect(html).toContain("System prompt for");
    expect(html).toContain("Show prompt");
    expect(html).not.toContain("First user message:");
  });
});

describe("LogEntryCard help metadata", () => {
  test("routes helpContent system entries to HelpCard", () => {
    const html = renderToStaticMarkup(
      createElement(LogEntryCard, {
        entry: {
          id: "log-1",
          agentId: "agent-1",
          timestamp: 1,
          kind: "system",
          content: "**Help**",
          metadata: { helpContent: "**Docs:** https://example.com\n\n## Commands you can type\n  `/help`" },
        },
      }),
    );
    expect(html).toContain("Show help");
    expect(html).not.toContain("https://example.com");
  });

  test("routes cronjobPromptContent system entries to PromptInspectCard", () => {
    const html = renderToStaticMarkup(
      createElement(LogEntryCard, {
        entry: {
          id: "log-2",
          agentId: "agent-1",
          timestamp: 1,
          kind: "system",
          content: '**System prompt for "Nightly check"**',
          metadata: { cronjobPromptContent: "Full prompt body", cronjobName: "Nightly check" },
        },
      }),
    );
    expect(html).toContain("Show prompt");
    expect(html).not.toContain("Full prompt body");
  });
});
