import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../Markdown.tsx";

describe("renderMarkdown math", () => {
  test("renders dollar-delimited display math", () => {
    const html = renderMarkdown("$$x^2$$");
    expect(html).toContain('data-katex-source="x^2"');
    expect(html).toContain('data-katex-display="true"');
  });

  test("renders bracket-delimited display math", () => {
    const html = renderMarkdown(String.raw`\[x^2\]`);
    expect(html).toContain('data-katex-source="x^2"');
    expect(html).toContain('data-katex-display="true"');
  });

  test("renders dollar-delimited inline math", () => {
    const html = renderMarkdown("Value: $x^2$.");
    expect(html).toContain('data-katex-source="x^2"');
    expect(html).toContain('data-katex-display="false"');
  });

  test("renders parenthesis-delimited inline math", () => {
    const html = renderMarkdown(String.raw`Value: \(x^2\).`);
    expect(html).toContain('data-katex-source="x^2"');
    expect(html).toContain('data-katex-display="false"');
  });

  test("keeps dollar amounts and unmatched dollars literal", () => {
    const html = renderMarkdown("It costs $20.00 and this $ stays.");
    expect(html).not.toContain('class="katex-math"');
    expect(html).toContain("$20.00");
    expect(html).toContain("this $ stays");
  });

  test("rejects a closing dollar followed by a digit", () => {
    const html = renderMarkdown("Keep $x$2 literal.");
    expect(html).not.toContain('class="katex-math"');
    expect(html).toContain("$x$2");
  });

  test("rejects an opening dollar followed by whitespace", () => {
    const html = renderMarkdown("Pay $ 5$ now.");
    expect(html).not.toContain('class="katex-math"');
    expect(html).toContain("Pay $ 5$ now.");
  });

  test("does not render math delimiters inside code", () => {
    const html = renderMarkdown("`$x$`\n\n```text\n$$x^2$$\n```");
    expect(html).not.toContain('class="katex-math"');
    expect(html).toContain("$x$");
    expect(html).toContain("$$x^2$$");
  });

  test("does not split prose around unmatched display delimiters", () => {
    const cases = [
      ["Use $$ to open display math.", "Use $$ to open display math."],
      ["Run echo $$ to print the pid.", "Run echo $$ to print the pid."],
      [String.raw`An index like a\[0\] is fine.`, "An index like a[0] is fine."],
      [String.raw`Write \[ to open display math.`, "Write [ to open display math."],
    ];
    for (const [source, rendered] of cases) {
      const html = renderMarkdown(source);
      expect(html).not.toContain("<br>");
      expect(html).toContain(rendered);
    }
  });

  test("does not split bracket display delimiters in prose", () => {
    const html = renderMarkdown(String.raw`So \[x^2\] holds.`);
    expect(html).not.toContain("<br>");
    expect(html).toContain("So [x^2] holds.");
  });

  test("keeps paired literal double dollars in prose", () => {
    for (const source of ["compare echo $$ in the parent with echo $$ in the child", "In a Makefile write $$HOME, not $HOME, to reach $$PATH."]) {
      const html = renderMarkdown(source);
      expect(html).not.toContain('class="katex-math"');
      expect(html).toContain(source);
    }
  });

  test("keeps an adjacent display delimiter in one paragraph", () => {
    const html = renderMarkdown("a$$x$$");
    expect(html).toContain("<p>a");
    expect(html).toContain('data-katex-source="x"');
    expect(html).toContain("</span></p>");
  });

  test("renders paired dollar display delimiters in prose without splitting it", () => {
    const html = renderMarkdown("So $$x^2$$ holds.");
    expect(html).not.toContain("<br>");
    expect(html).toContain('data-katex-source="x^2"');
    expect(html).toContain(" holds.");
  });

  test("keeps display delimiters byte-for-byte inside a code span", () => {
    expect(renderMarkdown("`$$y$$`")).toContain("<code>$$y$$</code>");
  });
});
