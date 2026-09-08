import { describe, it, expect } from "bun:test";
import { buildFormatterPrompt } from "../prompt.ts";
import { extractSlideHtml } from "../sanitize.ts";
import { slideModelFamily } from "../generate.ts";
import { turn } from "./slide-kit.ts";

describe("slide prompt + output helpers", () => {
  it("buildFormatterPrompt includes prompt, answer, style ref, and feedback", () => {
    const p = buildFormatterPrompt(turn(), "<div>prev</div>", "make it teal");
    expect(p).toContain("What is 2+2?");
    expect(p).toContain("It is 4.");
    expect(p).toContain("<div>prev</div>");
    expect(p).toContain("make it teal");
  });

  it("extractSlideHtml strips a stray code fence", () => {
    expect(extractSlideHtml("```html\n<div>x</div>\n```")).toBe("<div>x</div>");
  });

  it("extractSlideHtml throws when the model didn't return a root div", () => {
    expect(() => extractSlideHtml("Sorry, I can't.")).toThrow();
    expect(() => extractSlideHtml("<span>x</span>")).toThrow();
    expect(() => extractSlideHtml("<div>a</div><div>b</div>")).toThrow(); // multi-root
  });

  it("extractSlideHtml rejects network-capable / scriptable markup", () => {
    expect(() => extractSlideHtml('<div><img src="x"></div>')).toThrow();
    expect(() => extractSlideHtml('<div><a href="http://x">y</a></div>')).toThrow();
    expect(() => extractSlideHtml("<div><script>1</script></div>")).toThrow();
    expect(() => extractSlideHtml('<div style="background:url(http://x)">y</div>')).toThrow();
    expect(() => extractSlideHtml('<div onclick="x()">y</div>')).toThrow();
    expect(() => extractSlideHtml("<div><svg></svg></div>")).toThrow();
  });

  it("extractSlideHtml accepts a clean inline-styled slide", () => {
    const good = '<div style="width:100%;height:100%"><h1 style="color:#6ea8fe">Hi</h1></div>';
    expect(extractSlideHtml(good)).toBe(good);
  });

  it("extractSlideHtml accepts code TEXT that merely mentions href/url()/data:", () => {
    // "copy code verbatim": these are text/code nodes, not real markup - the CSP
    // is the boundary, so the validator must not reject them.
    const cases = [
      "<div><pre>&lt;a href=&quot;/docs&quot;&gt;</pre></div>",
      "<div><pre>background: url(/hero.png)</pre></div>",
      "<div><code>data:text/plain,hi</code></div>",
      "<div><code>curl https://api.example/v1</code></div>",
    ];
    for (const c of cases) expect(extractSlideHtml(c)).toBe(c);
  });

  it("extractSlideHtml treats a '>' inside a quoted attribute as one root", () => {
    // The quote-aware tokenizer keeps the tag intact, so the single-root check
    // isn't fooled into seeing a sibling.
    const good = `<div style="content:'a>b'"><span style="color:#6ea8fe">x</span></div>`;
    expect(extractSlideHtml(good)).toBe(good);
  });
});

describe("slideModelFamily", () => {
  // The formatter runs on a fixed cheap tier per backend, not the agent's own
  // (possibly frontier) family - the same rule topic generation uses.
  it("pins Claude agents to sonnet", () => {
    expect(slideModelFamily("claude")).toBe("sonnet");
  });

  it("pins Codex agents to a cheap GPT-5.x family", () => {
    expect(slideModelFamily("codex")).toBe("gpt-5.6-terra");
  });

  it("pins OpenCode agents to a cheap provider/model", () => {
    expect(slideModelFamily("opencode")).toBe("opencode/gpt-5-nano");
  });
});
