// Slide Mode output contract: turn the formatter's raw text into a slide
// fragment, or reject it. Pure - no I/O, no state.

// Strip a stray markdown fence if the model wrapped its output anyway.
function stripFence(s: string): string {
  const m = /^```(?:html)?\s*\n([\s\S]*?)\n```\s*$/.exec(s.trim());
  return (m ? m[1] : s).trim();
}

// Network-capable / interactive / scriptable markup that must never reach a
// persisted slide. The CSP in shared/slide-frame.ts is the real containment
// boundary; this is defense in depth (and a quality gate - the formatter is
// told not to emit these). A hit means the model ignored the contract, so we
// reject the whole slide and let the client fall back rather than persist it.
//
// IMPORTANT: these checks inspect only ACTUAL tags/attributes, never text/code
// content. A slide about HTML/CSS/URLs will legitimately contain escaped
// `href=`, `url(`, `data:` etc. as TEXT inside <pre>/<code> ("copy code
// verbatim"), which must not be rejected.
const BANNED_ELEMENTS = new Set([
  "script",
  "iframe",
  "img",
  "image",
  "a",
  "link",
  "meta",
  "base",
  "form",
  "input",
  "button",
  "select",
  "textarea",
  "video",
  "audio",
  "source",
  "object",
  "embed",
  "svg",
  "style",
  "frame",
  "frameset",
  "applet",
  "marquee",
]);

// Resource-loading attribute NAMES that must never appear on a slide element.
const BANNED_ATTR_NAMES = new Set(["src", "href", "xlink:href"]);

// One tag token, respecting quoted values (a ">" inside a quoted attribute
// doesn't end the tag): closing-slash (group 1), name (group 2), raw attribute
// text (group 3). Shared by isSingleRoot and the policy scanner via fresh
// instances so their lastIndex state can't collide.
const TAG_TOKEN_SRC = `<(/?)([a-zA-Z][a-zA-Z0-9-]*)((?:"[^"]*"|'[^']*'|[^>])*)>`;
const newTagScanner = (): RegExp => new RegExp(TAG_TOKEN_SRC, "g");
// One attribute within a tag's attribute text: name plus optional quoted/bare
// value. Checked by NAME (event handlers, resource refs) and, for style only,
// its VALUE (CSS url()). Values are otherwise ignored, so code-like text never
// trips this (CSP is the security boundary).
const ATTR_RE = /([a-zA-Z_:][a-zA-Z0-9_:.-]*)(?:\s*=\s*("[^"]*"|'[^']*'|[^\s>]+))?/g;

// Void / self-closing elements that don't open a nesting level. Most are banned
// outright above; kept here so the depth scan stays correct if one appears.
const VOID_ELEMENTS = /^(br|hr|img|input|meta|link|source|area|base|col|embed|track|wbr)$/i;

// Is the fragment exactly ONE top-level element (a single root)? Depth scan over
// tags: the first tag opens the root; if depth returns to 0 before the end,
// there is a sibling -> multiple roots.
function isSingleRoot(html: string): boolean {
  const tagRe = newTagScanner();
  let depth = 0;
  let closedAt = -1;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const closing = m[1] === "/";
    const selfClosing = /\/\s*$/.test(m[3]);
    if (closing) {
      depth--;
      if (depth === 0 && closedAt === -1) closedAt = tagRe.lastIndex;
      if (depth < 0) return false;
    } else if (!selfClosing && !VOID_ELEMENTS.test(m[2])) {
      depth++;
    }
  }
  // Balanced, and nothing but whitespace follows the root's close.
  return depth === 0 && closedAt !== -1 && html.slice(closedAt).trim() === "";
}

// Turn the model's raw text into a slide fragment, or throw when it violates the
// contract (so the caller journals it and the client shows its fallback). We
// require a single root <div>…</div> and no network-capable / scriptable markup.
export function extractSlideHtml(raw: string): string {
  const html = stripFence(raw);
  if (!/^<div[\s>]/i.test(html) || !isSingleRoot(html)) {
    throw new Error(`model did not return a single root <div> (got: ${html.slice(0, 80)}...)`);
  }
  // Inspect real tags/attributes only - not text/code content.
  const tagRe = newTagScanner();
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(html)) !== null) {
    const name = m[2].toLowerCase();
    if (BANNED_ELEMENTS.has(name)) {
      throw new Error(`slide contains banned element <${name}>`);
    }
    let a: RegExpExecArray | null;
    ATTR_RE.lastIndex = 0;
    while ((a = ATTR_RE.exec(m[3])) !== null) {
      const attr = a[1].toLowerCase();
      const value = (a[2] ?? "").replace(/^["']|["']$/g, "");
      if (attr.startsWith("on")) {
        throw new Error(`slide has an event-handler attribute (${attr})`);
      }
      if (BANNED_ATTR_NAMES.has(attr)) {
        throw new Error(`slide has a resource attribute (${attr})`);
      }
      if (attr === "style" && /url\s*\(/i.test(value)) {
        throw new Error("slide style uses CSS url()");
      }
    }
  }
  return html;
}
