import { describe, expect, test } from "bun:test";
import { citationBlock } from "./useCiteInsertion.ts";

describe("citationBlock", () => {
  test("escapes dollars in cited text", () => {
    expect(citationBlock("Use $PORT with $BUREAU_AGENT_TOKEN")).toBe('Cited text:\n"""\nUse \\$PORT with \\$BUREAU_AGENT_TOKEN\n"""\n');
  });

  test("keeps a custom title", () => {
    expect(citationBlock("hello", "Terminal output")).toBe('Terminal output:\n"""\nhello\n"""\n');
  });
});
