import { decodeHTMLStrict } from "entities";
import { Lexer, type Token, type Tokens } from "marked";
import { isApiTokenDevice } from "../../shared/identity.ts";
import type { LogEntry } from "../../shared/types.ts";

// What the chat header's Copy puts on the clipboard. "messages" leaves out
// tool calls, "mine" keeps only the viewer's own messages, "lastExchange"
// runs from the last incoming message to the end.
export type ChatCopyScope = "messages" | "mine" | "everything" | "lastExchange";
export type ChatCopyFormat = "markdown" | "plain";

export const CHAT_COPY_SCOPES: ChatCopyScope[] = ["messages", "mine", "everything", "lastExchange"];

export interface ChatCopyOptions {
  format: ChatCopyFormat;
  agentName: string;
  // The signed-in member; an office without sign-in passes null.
  viewer: string | null;
  // The label shown for a message sender, as the chat shows it.
  senderLabel: (entry: LogEntry) => string;
}

export function chatCopyText(entries: LogEntry[], scope: ChatCopyScope, options: ChatCopyOptions): string {
  return labelSpeakers(chatCopyEntries(entries, scope, options.viewer), options);
}

export function chatCopyEntries(entries: LogEntry[], scope: ChatCopyScope, viewer: string | null): LogEntry[] {
  if (scope === "mine") {
    const me = viewer?.trim().toLowerCase();
    return entries.filter((e) => e.kind === "user_message" && isMemberMessage(e) && (!me || (e.metadata?.username as string | undefined)?.trim().toLowerCase() === me));
  }
  if (scope === "messages") return entries.filter((e) => e.kind === "user_message" || e.kind === "text" || e.kind === "api_token_outbound");
  if (scope === "lastExchange") {
    // Any incoming message starts an exchange, whoever sent it: an agent that
    // other agents drive may have its last member message hours back.
    const start = entries.findLastIndex((e) => e.kind === "user_message");
    return entries.slice(Math.max(start, 0));
  }
  return entries;
}

// Agent, cron job, webhook and API-token sends are not the member's own.
function isMemberMessage(entry: LogEntry): boolean {
  const meta = entry.metadata ?? {};
  return !meta.sender_agent_name && !meta.sender_cronjob_name && !meta.sender_webhook_name && !isApiTokenDevice(meta.device as string | undefined);
}

// Each run of one speaker opens with its name. In Markdown the name is bold
// on its own block, so a reply that starts with a list or table still renders.
// A member's message stays as typed in both formats: the chat shows it raw.
function labelSpeakers(entries: LogEntry[], { format, agentName, senderLabel }: ChatCopyOptions): string {
  const parts: string[] = [];
  let speaker: string | undefined;
  for (const e of entries) {
    let block: string;
    let who = agentName;
    if (e.kind === "user_message") {
      block = e.content;
      who = senderLabel(e);
    } else if (e.kind === "text") {
      block = format === "plain" ? markdownToPlainText(e.content) : e.content;
    } else if (e.kind === "api_token_outbound") {
      const recipient = e.metadata?.recipient_api_token_name;
      block = typeof recipient === "string" ? `[To remote boss "${recipient}"] ${e.content}` : e.content;
    } else if (e.kind === "tool_call") {
      const input = e.metadata?.input;
      block = `${format === "plain" ? e.content : `**${e.content}**`}\n${typeof input === "string" ? input : JSON.stringify(input, null, 2)}`;
    } else continue;
    if (who !== speaker) {
      speaker = who;
      if (format === "plain") block = `${who}:\n${block}`;
      else parts.push(`**${who.replace(/[!-/:-@[-`{-~]/g, "\\$&")}:**`);
    }
    parts.push(block);
  }
  return parts.join("\n\n");
}

// An agent reply as the reader sees it: emphasis, fences and link brackets
// go; the words, code, list markers and link targets stay.
export function markdownToPlainText(markdown: string): string {
  return blocksText(new Lexer({ gfm: true, breaks: true }).lex(markdown));
}

function blocksText(tokens: Token[], separator = "\n\n"): string {
  return tokens
    .map(blockText)
    .filter((text) => text !== "")
    .join(separator);
}

function blockText(token: Token): string {
  const t = token as Tokens.Generic;
  switch (token.type) {
    case "space":
    case "hr":
    case "def":
      return "";
    case "code":
      return t.text as string;
    case "html":
      return (t.text as string).replace(/\n+$/, "");
    case "blockquote":
      return blocksText(t.tokens ?? []);
    case "list":
      return listText(token as Tokens.List);
    case "table": {
      const table = token as Tokens.Table;
      const row = (cells: Tokens.TableCell[]) => cells.map((cell) => inlineText(cell.tokens)).join(" | ");
      return [row(table.header), ...table.rows.map(row)].join("\n");
    }
    default:
      return t.tokens ? inlineText(t.tokens) : decodeHTMLStrict((t.text as string) ?? "");
  }
}

// Items keep their marker; continuation lines and nested lists indent under it.
function listText(list: Tokens.List): string {
  const start = typeof list.start === "number" ? list.start : 1;
  return list.items
    .map((item, index) => {
      let marker = list.ordered ? `${start + index}. ` : "- ";
      if (item.task) marker += item.checked ? "[x] " : "[ ] ";
      const body = blocksText(
        item.tokens.filter((tok) => tok.type !== "checkbox"),
        item.loose ? "\n\n" : "\n",
      );
      const indent = " ".repeat(list.ordered ? marker.length : 2);
      return (
        marker +
        body
          .split("\n")
          .map((line, i) => (i === 0 || line === "" ? line : indent + line))
          .join("\n")
      );
    })
    .join(list.loose ? "\n\n" : "\n");
}

function inlineText(tokens: Token[]): string {
  return tokens.map(inlineTokenText).join("");
}

function inlineTokenText(token: Token): string {
  const t = token as Tokens.Generic;
  switch (token.type) {
    case "br":
      return "\n";
    case "checkbox":
      return "";
    case "codespan":
    case "escape":
    case "html":
      return t.text as string;
    case "link": {
      const text = inlineText(t.tokens ?? []);
      const href = t.href as string;
      return text === href || `mailto:${text}` === href ? text : `${text} (${href})`;
    }
    case "image": {
      const alt = decodeHTMLStrict(t.text as string);
      return alt ? `${alt} (${t.href})` : (t.href as string);
    }
    default:
      if (t.tokens) return inlineText(t.tokens);
      return t.escaped ? (t.text as string) : decodeHTMLStrict((t.text as string) ?? "");
  }
}
