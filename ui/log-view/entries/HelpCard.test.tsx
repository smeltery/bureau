import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { HelpCard } from "./HelpCard.tsx";
import { LogEntryCard } from "./index.tsx";

describe("HelpCard", () => {
  test("renders a compact card with Show help affordance", () => {
    const html = renderToStaticMarkup(createElement(HelpCard, { header: "**Help**", helpContent: "## Commands\n`/help`" }));
    expect(html).toContain("Help");
    expect(html).toContain("Show help");
    expect(html).not.toContain("## Commands");
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
});
