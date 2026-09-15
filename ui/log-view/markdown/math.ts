/** Escape a math source string for a data-* HTML attribute. */
export function escapeHtmlAttr(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function mathPlaceholder(source: string, displayMode: boolean): string {
  const escaped = escapeHtmlAttr(source);
  return `<span class="katex-math" data-katex-source="${escaped}" data-katex-display="${displayMode}">${escaped}</span>`;
}

type MathToken = { source: string };

function sourceOf(token: unknown): string {
  return (token as MathToken).source ?? "";
}

/**
 * Marked extensions for TeX delimiters. Code spans and fences keep their
 * usual precedence, so `$x$` inside backticks stays literal. Dollar inline
 * math rejects currency-like text: no whitespace on either edge of the
 * dollars, and a closing dollar followed by a digit is not a delimiter.
 *
 * Register `inlineDisplayMathDollar` after `inlineMathDollar` so `$$...$$` in
 * prose is one token instead of three single-dollar matches.
 */
export const mathBlockExtensions = [
  {
    name: "displayMathDollar",
    level: "block" as const,
    start(src: string) {
      const match = /\n\$\$[\s\S]+?\$\$[ \t]*(?:\n|$)/.exec(src);
      return match ? match.index + match[0].indexOf("$$") : undefined;
    },
    tokenizer(src: string) {
      const match = /^\$\$([\s\S]+?)\$\$(?:[ \t]*(?:\n|$))/.exec(src);
      if (!match) return undefined;
      return { type: "displayMathDollar", raw: match[0], source: match[1] };
    },
    renderer(token: unknown) {
      return `${mathPlaceholder(sourceOf(token), true)}\n`;
    },
  },
  {
    name: "displayMathBracket",
    level: "block" as const,
    start(src: string) {
      const match = /\n\\\[[\s\S]+?\\\][ \t]*(?:\n|$)/.exec(src);
      return match ? match.index + match[0].indexOf("\\[") : undefined;
    },
    tokenizer(src: string) {
      const match = /^\\\[([\s\S]+?)\\\](?:[ \t]*(?:\n|$))/.exec(src);
      if (!match) return undefined;
      return { type: "displayMathBracket", raw: match[0], source: match[1] };
    },
    renderer(token: unknown) {
      return `${mathPlaceholder(sourceOf(token), true)}\n`;
    },
  },
];

export const mathInlineExtensions = [
  {
    name: "inlineMathParen",
    level: "inline" as const,
    start: (src: string) => src.indexOf("\\("),
    tokenizer(src: string) {
      const match = /^\\\(([\s\S]+?)\\\)/.exec(src);
      if (!match) return undefined;
      return { type: "inlineMathParen", raw: match[0], source: match[1] };
    },
    renderer(token: unknown) {
      return mathPlaceholder(sourceOf(token), false);
    },
  },
  {
    name: "inlineMathDollar",
    level: "inline" as const,
    start: (src: string) => src.indexOf("$"),
    tokenizer(src: string) {
      const match = /^\$(?![\s$])([\s\S]*?[^\s$])\$(?!\d)/.exec(src);
      if (!match) return undefined;
      return { type: "inlineMathDollar", raw: match[0], source: match[1] };
    },
    renderer(token: unknown) {
      return mathPlaceholder(sourceOf(token), false);
    },
  },
];

export const mathInlineDisplayExtension = {
  name: "inlineDisplayMathDollar",
  level: "inline" as const,
  start: (src: string) => src.indexOf("$$"),
  tokenizer(src: string) {
    const match = /^\$\$(?![\s$])([\s\S]*?[^\s$])\$\$/.exec(src);
    if (!match) return undefined;
    return { type: "inlineDisplayMathDollar", raw: match[0], source: match[1] };
  },
  renderer(token: unknown) {
    return mathPlaceholder(sourceOf(token), true);
  },
};
