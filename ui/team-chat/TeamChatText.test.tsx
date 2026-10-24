import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { TeamChatText } from "./TeamChatText.tsx";

const render = (content: string) => renderToStaticMarkup(<TeamChatText content={content} />);

test("formats nested emphasis and web/email links while preserving line breaks", () => {
  const html = render("**Ready *today***\n[Docs](https://example.com) www.example.com <hello@example.com>");
  expect(html).toContain("<strong>Ready <em>today</em></strong>\n");
  expect(html).toContain('href="https://example.com"');
  expect(html).toContain('href="http://www.example.com"');
  expect(html).toContain('href="mailto:hello@example.com"');
  expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(3);
  expect(html.match(/target="_blank"/g)).toHaveLength(3);
});

test("renders unsafe and relative link destinations as literal text", () => {
  for (const href of ["javascript:alert(1)", "data:text/html,hello", "file:///etc/passwd", "//example.com", "/api/logout", "vbscript:hello"]) {
    const html = render("[click](" + href + ")");
    expect(html).not.toContain("<a");
    expect(html).toContain("[click]");
  }
});

test("keeps HTML, images, code, diagrams and unsupported formatting inert", () => {
  const html = render("<img src=x onerror=alert(1)> <svg onload=alert(1)>\n![image](https://example.com/a.png)\n`**literal**`\n~~literal~~\n# heading\n```mermaid\ngraph TD; A-->B\n```");
  for (const tag of ["<img", "<svg", "<script", "<code", "<del", "<h1", "<iframe"]) expect(html).not.toContain(tag);
  expect(html).toContain("&lt;img");
  expect(html).toContain("![image](https://example.com/a.png)");
  expect(html).toContain("`**literal**`");
  expect(html).toContain("~~literal~~");
  expect(html).toContain("# heading");
  expect(html).toContain("mermaid");
});

test("escapes link labels and attributes and supports literal escaped punctuation", () => {
  const html = render('[<img src=x onerror=alert(1)>](https://example.com "title") \\*literal\\*');
  expect(html).not.toContain("<img");
  expect(html).toContain("&lt;img");
  expect(html).toContain("*literal*");
  expect(html).not.toContain("<em>");
});
