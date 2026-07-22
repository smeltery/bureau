import { describe, expect, test } from "bun:test";
import { renderMarkdown } from "../Markdown.tsx";
import { sanitizeSvg } from "./svg-sanitize.ts";

describe("sanitizeSvg", () => {
  test("keeps common shape and presentation elements", () => {
    const out = sanitizeSvg(
      `<svg width="100" viewBox="0 0 100 50"><defs><marker id="m"><path d="M0 0L4 2L0 4z"/></marker></defs><g transform="translate(1,2)"><rect width="20" height="10" fill="#333" rx="2"/><line x1="0" y1="0" x2="5" y2="5" marker-end="url(#m)"/><text x="2" y="8">hi</text></g></svg>`,
    );

    expect(out).toContain(`<svg width="100" viewBox="0 0 100 50">`);
    expect(out).toContain(`<marker id="m">`);
    expect(out).toContain(`<rect width="20" height="10" fill="#333" rx="2"/>`);
    expect(out).toContain(`marker-end="url(#m)"`);
    expect(out).toContain(`<text x="2" y="8">hi</text>`);
  });

  test("drops script, foreign content, event handlers, and styles", () => {
    const out = sanitizeSvg(
      `<svg onload="alert(1)"><script>alert(2)</script><foreignObject><img src="x"/></foreignObject><rect width="5" onclick="alert(3)" style="filter:url(https://example.com/x.svg#f)"/></svg>`,
    );

    expect(out).not.toContain("script");
    expect(out).not.toContain("foreignObject");
    expect(out).not.toContain("alert");
    expect(out).not.toContain("onclick");
    expect(out).not.toContain("style");
    expect(out).toContain(`<rect width="5"/>`);
  });

  test("allows same-document references and blocks external references", () => {
    const out = sanitizeSvg(
      `<svg><use href="#icon"/><use xlink:href="#icon2"/><use href="https://example.com/icon.svg#x"/><rect fill="url(#g)" stroke="rgb(1, 2, 3)"/><rect fill="url(https://example.com/x.svg#g)"/></svg>`,
    );

    expect(out).toContain(`href="#icon"`);
    expect(out).toContain(`xlink:href="#icon2"`);
    expect(out).toContain(`fill="url(#g)"`);
    expect(out).toContain(`stroke="rgb(1, 2, 3)"`);
    expect(out).not.toContain("https://example.com");
  });

  test("escapes text and attribute values", () => {
    const out = sanitizeSvg(`<svg><text font-family='He said "hi"'>a < b & c > d</text></svg>`);

    expect(out).toContain(`font-family="He said &quot;hi&quot;"`);
    expect(out).toContain("a &lt; b &amp; c &gt; d");
  });
});

describe("renderMarkdown svg capture", () => {
  test("keeps multiline svg intact when prose precedes it", () => {
    const html = renderMarkdown(`Diagram:\n<svg width="20">\n  <rect width="5"/>\n  <text>hi</text>\n</svg>`);
    const svg = html.slice(html.indexOf("<svg"), html.indexOf("</svg>"));

    expect(svg).toContain(`<rect width="5"/>`);
    expect(svg).toContain(`<text>hi</text>`);
    expect(svg).not.toContain("<br");
    expect(svg).not.toContain("<p>");
  });

  test("captures inline svg without touching code spans", () => {
    const html = renderMarkdown(`Look <svg width="5"><rect width="1"/></svg> here and \`<svg></svg>\`.`);

    expect(html).toContain(`Look <svg width="5"><rect width="1"/></svg> here`);
    expect(html).toContain(`<code>&lt;svg&gt;&lt;/svg&gt;</code>`);
  });

  test("sanitizes captured svg", () => {
    const html = renderMarkdown(`<svg onload="alert(1)"><script>alert(2)</script><rect width="5"/></svg>`);

    expect(html).not.toContain("onload");
    expect(html).not.toContain("alert");
    expect(html).toContain(`<rect width="5"/>`);
  });
});
