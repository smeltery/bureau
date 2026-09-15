import { useMemo, useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Marked } from "marked";
import { markedHighlight } from "marked-highlight";
import hljs from "highlight.js/lib/core";
import javascript from "highlight.js/lib/languages/javascript";
import typescript from "highlight.js/lib/languages/typescript";
import python from "highlight.js/lib/languages/python";
import bash from "highlight.js/lib/languages/bash";
import json from "highlight.js/lib/languages/json";
import css from "highlight.js/lib/languages/css";
import xml from "highlight.js/lib/languages/xml";
import go from "highlight.js/lib/languages/go";
import rust from "highlight.js/lib/languages/rust";
import sql from "highlight.js/lib/languages/sql";
import diff from "highlight.js/lib/languages/diff";
import yaml from "highlight.js/lib/languages/yaml";
import markdown from "highlight.js/lib/languages/markdown";
import plaintext from "highlight.js/lib/languages/plaintext";
import { renderMermaidBlocks } from "./markdown/mermaid.ts";
import { mathBlockExtensions, mathInlineDisplayExtension, mathInlineExtensions } from "./markdown/math.ts";
import { renderKatexBlocks } from "./markdown/katex.ts";
import { sanitizeSvg } from "./markdown/svg-sanitize.ts";
import { taskChipLabel, type TaskMap } from "./task-links.tsx";
import { copyText } from "../utils/clipboard.ts";

hljs.registerLanguage("javascript", javascript);
hljs.registerLanguage("js", javascript);
hljs.registerLanguage("typescript", typescript);
hljs.registerLanguage("ts", typescript);
hljs.registerLanguage("python", python);
hljs.registerLanguage("py", python);
hljs.registerLanguage("bash", bash);
hljs.registerLanguage("sh", bash);
hljs.registerLanguage("shell", bash);
hljs.registerLanguage("json", json);
hljs.registerLanguage("css", css);
hljs.registerLanguage("html", xml);
hljs.registerLanguage("xml", xml);
hljs.registerLanguage("go", go);
hljs.registerLanguage("rust", rust);
hljs.registerLanguage("sql", sql);
hljs.registerLanguage("diff", diff);
hljs.registerLanguage("yaml", yaml);
hljs.registerLanguage("yml", yaml);
hljs.registerLanguage("markdown", markdown);
hljs.registerLanguage("md", markdown);
hljs.registerLanguage("plaintext", plaintext);
hljs.registerLanguage("text", plaintext);
hljs.registerLanguage("txt", plaintext);

const marked = new Marked(
  markedHighlight({
    langPrefix: "hljs language-",
    highlight(code, lang) {
      if (lang && hljs.getLanguage(lang)) {
        return hljs.highlight(code, { language: lang }).value;
      }
      // Auto-detect for unlabeled code blocks
      return hljs.highlightAuto(code).value;
    },
  }),
);

marked.setOptions({
  breaks: true,
  gfm: true,
});

// Override link renderer to always open in new tab
const renderer = new marked.Renderer();
renderer.link = ({ href, title, text }) => {
  const titleAttr = title ? ` title="${title}"` : "";
  return `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${text}</a>`;
};
marked.use({ renderer });

// Capture ```mermaid fenced blocks before the default fenced-code tokenizer.
// Emits a <div class="mermaid-wrapper"> containing an empty <div class="mermaid">
// whose data-mermaid-source attribute holds the diagram source. The React
// effect below lazy-loads mermaid and replaces the inner div with the
// rendered SVG. Carrying the source on a data attribute (rather than as the
// div's textContent) means the effect can safely overwrite the div's
// contents without losing the source, e.g. if the effect ever re-fires.
const escapeHtmlAttr = (s: string) => s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
marked.use({
  extensions: [
    {
      name: "svgInline",
      level: "inline",
      start(src: string) {
        const idx = src.indexOf("<svg");
        return idx >= 0 ? idx : undefined;
      },
      tokenizer(src: string) {
        const match = /^<svg\b[\s\S]*?<\/svg>/.exec(src);
        if (!match) return undefined;
        return { type: "svgInline", raw: match[0], source: match[0] };
      },
      renderer(token) {
        return sanitizeSvg((token as { source?: string }).source ?? "");
      },
    },
    {
      name: "mermaidBlock",
      level: "block",
      start(src: string) {
        const idx = src.indexOf("```mermaid");
        return idx >= 0 ? idx : undefined;
      },
      tokenizer(src: string) {
        const match = /^```mermaid[ \t]*\n([\s\S]*?)\n```(?:[ \t]*(?:\n|$))/.exec(src);
        if (!match) return undefined;
        return {
          type: "mermaidBlock",
          raw: match[0],
          source: match[1],
        };
      },
      renderer(token) {
        const source = (token as { source?: string }).source ?? "";
        return `<div class="mermaid-wrapper">` + `<div class="mermaid" data-mermaid-source="${escapeHtmlAttr(source)}"></div>` + `</div>\n`;
      },
    },
  ],
});

marked.use({
  extensions: [
    {
      name: "taskId",
      level: "inline",
      start(src: string) {
        return src.search(/\b[0-9a-f]{8}\b/);
      },
      tokenizer(src: string) {
        if (this.lexer.state.inLink) return;
        const match = /^\b[0-9a-f]{8}\b/.exec(src);
        if (!match) return;
        return { type: "taskId", raw: match[0], id: match[0] };
      },
      renderer(token) {
        const id = (token as { id: string }).id;
        return `<span data-task-id="${id}">${id}</span>`;
      },
    },
  ],
});

marked.use({ extensions: mathBlockExtensions });
marked.use({ extensions: mathInlineExtensions });
marked.use({ extensions: [mathInlineDisplayExtension] });

const COPY_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1.5 1.5 0 0 0-1.5-1.5H3.5A1.5 1.5 0 0 0 2 3.5V9a1.5 1.5 0 0 0 1.5 1.5h2"/></svg>`;
const CHECK_SVG = `<svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3.5 8.5 6.5 11.5 12.5 4.5"/></svg>`;
const COPY_BTN_HTML = `<button class="copy-btn code-copy-btn" title="Copy">${COPY_SVG}</button>`;

export function renderMarkdown(content: string): string {
  const raw = marked.parse(content) as string;
  const withCode = raw.replace(/<pre>/g, `<div class="code-block-wrapper">${COPY_BTN_HTML}<pre>`).replace(/<\/pre>/g, `</pre></div>`);
  return withCode.replace(/<table>/g, `<div class="table-wrapper"><table>`).replace(/<\/table>/g, `</table></div>`);
}

const EMPTY_TASKS: TaskMap = new Map();

export function Markdown({ content, tasks = EMPTY_TASKS, onOpenTask }: { content: string; tasks?: TaskMap; onOpenTask?: (id: string) => void }) {
  const html = useMemo(() => {
    try {
      return renderMarkdown(content);
    } catch {
      return content;
    }
  }, [content]);

  const onClick = useCallback(
    async (e: React.MouseEvent) => {
      const taskChip = (e.target as HTMLElement).closest<HTMLElement>(".task-id-chip[data-task-id]");
      if (taskChip?.dataset.taskId && onOpenTask) {
        e.preventDefault();
        e.stopPropagation();
        onOpenTask(taskChip.dataset.taskId);
        return;
      }
      const btn = (e.target as HTMLElement).closest(".code-copy-btn");
      if (!btn) return;
      e.stopPropagation();
      const wrapper = btn.closest(".code-block-wrapper");
      const pre = wrapper?.querySelector("pre");
      if (!pre) return;
      const code = pre.querySelector("code");
      const text = code ? (code.textContent ?? "") : (pre.textContent ?? "");
      const ok = await copyText(text);
      if (!ok) return;
      btn.innerHTML = CHECK_SVG;
      (btn as HTMLElement).style.color = "var(--green)";
      (btn as HTMLElement).style.background = "var(--green-bg)";
      setTimeout(() => {
        btn.innerHTML = COPY_SVG;
        (btn as HTMLElement).style.color = "";
        (btn as HTMLElement).style.background = "";
      }, 1500);
    },
    [onOpenTask],
  );

  const containerRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    root.innerHTML = html;
  }, [html]);

  useLayoutEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    for (const current of root.querySelectorAll<HTMLElement>("[data-task-id]")) {
      const id = current.dataset.taskId;
      const task = id ? tasks.get(id) : undefined;
      if (!task || !onOpenTask) {
        if (current.tagName === "SPAN") continue;
        const plain = document.createElement("span");
        plain.dataset.taskId = id ?? "";
        plain.textContent = id ?? current.textContent;
        current.replaceWith(plain);
        continue;
      }
      const chip = current.tagName === "BUTTON" ? (current as HTMLButtonElement) : document.createElement("button");
      chip.type = "button";
      chip.className = "task-id-chip";
      chip.dataset.taskId = id;
      chip.title = task.title;
      chip.textContent = taskChipLabel(task);
      if (chip !== current) current.replaceWith(chip);
    }
  }, [html, tasks, onOpenTask]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    return renderMermaidBlocks(root);
  }, [html]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) return;
    return renderKatexBlocks(root);
  }, [html]);

  return <div ref={containerRef} className="md-content" onClick={(e) => void onClick(e)} />;
}
