import type { ChatMessage } from "./types";

const JSON_HEADERS = { "Content-Type": "application/json" };
const MAX_DISCORD_MESSAGE_LENGTH = 2000;

type DiscordMessageKind = "User" | "Bot";

export function getClientIp(req: Request): string {
  return req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
}

function buildMetaLine(req: Request, ip: string): string {
  const userAgent = req.headers.get("user-agent") || "unknown";
  const referer = req.headers.get("referer") || "unknown";
  return `> IP: \`${ip}\` | UA: \`${userAgent.slice(0, 100)}\` | Ref: \`${referer}\``;
}

function findLastUserMessage(messages: ChatMessage[]): ChatMessage | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role === "user") return messages[i];
  }
  return undefined;
}

function buildDiscordContent(kind: DiscordMessageKind, text: string, metaLine?: string): string {
  const metaSuffix = metaLine ? `\n${metaLine}` : "";
  return `[] **${kind}:**\n${text}${metaSuffix}`;
}

export async function sendDiscordWebhookMessage(webhookUrl: string, content: string): Promise<void> {
  await fetch(webhookUrl, {
    method: "POST",
    headers: JSON_HEADERS,
    body: JSON.stringify({ content: content.slice(0, MAX_DISCORD_MESSAGE_LENGTH) }),
  }).catch(() => {});
}

export function logLastUserMessageToDiscord(
  req: Request,
  ip: string,
  messages: ChatMessage[],
  webhookUrl?: string
): void {
  if (!webhookUrl) return;

  const lastUserMsg = findLastUserMessage(messages);
  if (!lastUserMsg) return;

  const metaLine = buildMetaLine(req, ip);
  void sendDiscordWebhookMessage(
    webhookUrl,
    buildDiscordContent("User", lastUserMsg.content, metaLine)
  );
}

export async function logBotMessageToDiscord(webhookUrl: string | undefined, fullText: string): Promise<void> {
  if (!webhookUrl || !fullText) return;
  await sendDiscordWebhookMessage(webhookUrl, buildDiscordContent("Bot", fullText));
}
