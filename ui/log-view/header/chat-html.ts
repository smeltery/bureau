import { Marked, type Tokens } from "marked";
import type { LogEntry } from "../../../shared/types.ts";
import { chatCopyEntries, type ChatCopyFormat, type ChatCopyOptions, type ChatCopyScope } from "./chat-copy.ts";

// The Copy menu copies Markdown or plain text, or saves an HTML file.
export type ChatCopyOutput = ChatCopyFormat | "html";
export const CHAT_COPY_OUTPUTS: ChatCopyOutput[] = ["markdown", "plain", "html"];
// What one menu pick produces; an HTML file also carries its name.
export type ChatCopyGetter = (scope: ChatCopyScope, output: ChatCopyOutput) => { text: string; fileName?: string };

// The Copy menu's HTML file: one page with its own CSS and no script, that
// opens offline and loads nothing from the office.
export interface ChatHtmlOptions extends Omit<ChatCopyOptions, "format"> {
  language: string;
  exportedAt: Date;
  // The export date as the viewer reads it.
  dateLabel: string;
}

// Agent replies render as Markdown, but raw HTML shows as text, links keep
// only outside addresses and images become links, so the file stays inert.
const marked = new Marked({ gfm: true, breaks: true });
marked.use({
  renderer: {
    html: ({ text }: Tokens.HTML | Tokens.Tag) => escapeHtml(text),
    link({ href, tokens }: Tokens.Link) {
      const text = this.parser.parseInline(tokens);
      return isOutsideLink(href) ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${text}</a>` : text;
    },
    image({ href, text }: Tokens.Image) {
      const label = escapeHtml(text || href);
      return isOutsideLink(href) ? `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>` : label;
    },
  },
});

export function chatHtmlDocument(entries: LogEntry[], scope: ChatCopyScope, options: ChatHtmlOptions): string {
  const turns: string[] = [];
  let speaker: string | undefined;
  for (const e of chatCopyEntries(entries, scope, options.viewer)) {
    const block = entryHtml(e);
    if (block === null) continue;
    const who = e.kind === "user_message" ? options.senderLabel(e) : options.agentName;
    if (who !== speaker) {
      if (speaker !== undefined) turns.push("</section>");
      speaker = who;
      turns.push(`<section class="${e.kind === "user_message" ? "turn member" : "turn agent"}">\n<h2>${escapeHtml(who)}</h2>`);
    }
    turns.push(block);
  }
  if (speaker !== undefined) turns.push("</section>");
  const title = escapeHtml(options.agentName);
  return `<!doctype html>
<html lang="${escapeHtml(options.language)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${title}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<main>
<header><strong>${title}</strong> · <time datetime="${options.exportedAt.toISOString()}">${escapeHtml(options.dateLabel)}</time></header>
${turns.join("\n")}
</main>
</body>
</html>
`;
}

// `ada-2026-11-04.html`: the agent's name, made safe for any file system.
export function chatHtmlFileName(agentName: string, exportedAt: Date): string {
  const base =
    agentName
      .trim()
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-+|-+$/g, "") || "chat";
  return `${base}-${exportedAt.toISOString().slice(0, 10)}.html`;
}

// Hands the page to the browser as a download.
export function saveHtmlFile(html: string, fileName: string): void {
  const url = URL.createObjectURL(new Blob([html], { type: "text/html;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

function entryHtml(e: LogEntry): string | null {
  if (e.kind === "user_message") return `<div class="plain">${escapeHtml(e.content)}</div>`;
  if (e.kind === "text") return `<div class="reply">${marked.parse(e.content, { async: false })}</div>`;
  if (e.kind === "api_token_outbound") {
    const recipient = e.metadata?.recipient_api_token_name;
    return `<div class="plain">${escapeHtml(typeof recipient === "string" ? `[To remote boss "${recipient}"] ${e.content}` : e.content)}</div>`;
  }
  if (e.kind === "tool_call") {
    const input = e.metadata?.input;
    const body = typeof input === "string" ? input : JSON.stringify(input, null, 2);
    return `<details class="tool"><summary>${escapeHtml(e.content)}</summary><pre>${escapeHtml(body ?? "")}</pre></details>`;
  }
  return null;
}

function isOutsideLink(href: string): boolean {
  return /^(https?:\/\/|mailto:)/i.test(href.trim());
}

function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const PAGE_CSS = `
:root { color-scheme: light dark; --bg: #fafaf7; --text: #1f2328; --dim: #656d76; --border: #d8dee4; --card: #ffffff; --code: #f3f4f6; --accent: #0969da; }
@media (prefers-color-scheme: dark) { :root { --bg: #15171a; --text: #e6e6e6; --dim: #9aa1a9; --border: #30363d; --card: #1c1f24; --code: #24292f; --accent: #58a6ff; } }
body { margin: 0; background: var(--bg); color: var(--text); font: 14px/1.55 system-ui, -apple-system, "Segoe UI", sans-serif; }
main { max-width: 820px; margin: 0 auto; padding: 16px 20px 48px; }
header { padding-bottom: 10px; margin-bottom: 16px; border-bottom: 1px solid var(--border); color: var(--dim); font-size: 13px; }
header strong { color: var(--text); }
.turn { margin: 0 0 16px; padding: 10px 14px; border: 1px solid var(--border); border-radius: 10px; background: var(--card); }
.turn.member { border-left: 3px solid var(--accent); }
h2 { margin: 0 0 6px; font-size: 12px; color: var(--dim); }
.plain { white-space: pre-wrap; overflow-wrap: anywhere; }
.plain + .plain, .reply + .plain, .plain + .reply, .tool { margin-top: 8px; }
.reply > :first-child { margin-top: 0; }
.reply > :last-child { margin-bottom: 0; }
pre, code { font-family: ui-monospace, "JetBrains Mono", Menlo, monospace; font-size: 12px; background: var(--code); border-radius: 6px; }
code { padding: 1px 4px; }
pre { padding: 8px 10px; overflow-x: auto; }
pre code { padding: 0; background: none; }
table { border-collapse: collapse; } th, td { border: 1px solid var(--border); padding: 4px 8px; }
blockquote { margin: 0; padding-left: 12px; border-left: 3px solid var(--border); color: var(--dim); }
a { color: var(--accent); }
hr { border: 0; border-top: 1px solid var(--border); }
summary { cursor: pointer; color: var(--dim); font-size: 12px; }
`;
