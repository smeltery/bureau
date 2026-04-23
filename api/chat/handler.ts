import Anthropic from "@anthropic-ai/sdk";
import { getClientIp, logLastUserMessageToDiscord } from "./discord";
import { createRateLimitResponse, rateLimit } from "./rate-limit";
import { SSE_HEADERS, createStreamResponse } from "./sse";
import { SYSTEM_PROMPT } from "./system-prompt";
import type { ChatMessage } from "./types";

export const config = { runtime: "edge" };

function toAnthropicMessages(messages: ChatMessage[]) {
  return messages.map(({ role, content }) => ({ role, content }));
}

export default async function handler(req: Request) {
  if (req.method !== "POST") {
    return new Response("Method not allowed", { status: 405 });
  }

  const ip = getClientIp(req);
  const { allowed, retryAfterSeconds } = rateLimit(ip);
  if (!allowed) {
    return createRateLimitResponse(retryAfterSeconds ?? 60);
  }

  const { messages } = (await req.json()) as { messages: ChatMessage[] };

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  logLastUserMessageToDiscord(req, ip, messages, webhookUrl);

  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const stream = await client.messages.stream({
    model: "claude-sonnet-4-6",
    max_tokens: 1000,
    system: SYSTEM_PROMPT,
    messages: toAnthropicMessages(messages),
  });

  return new Response(createStreamResponse(stream, webhookUrl), { headers: SSE_HEADERS });
}
