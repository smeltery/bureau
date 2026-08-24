import { getClientIp, logLastUserMessageToDiscord } from "./discord";
import { createRateLimitResponse, rateLimit } from "./rate-limit";
import { SSE_HEADERS, createStreamResponse } from "./sse";
import { SYSTEM_PROMPT } from "./system-prompt";
import type { ChatMessage } from "./types";

export const config = { runtime: "edge" };

type AnthropicStreamEvent = {
  type?: string;
  delta?: { type?: string; text?: string };
};

async function* parseAnthropicStream(
  body: ReadableStream<Uint8Array>
): AsyncGenerator<AnthropicStreamEvent> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).replace(/\r$/, "");
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        yield JSON.parse(payload) as AnthropicStreamEvent;
      } catch {
        // ignore malformed frame
      }
    }
  }
}

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

  const upstream = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": process.env.ANTHROPIC_API_KEY ?? "",
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-sonnet-5",
      max_tokens: 1000,
      system: SYSTEM_PROMPT,
      stream: true,
      messages: toAnthropicMessages(messages),
    }),
  });

  if (!upstream.ok || !upstream.body) {
    const errText = await upstream.text().catch(() => "");
    return new Response(
      JSON.stringify({
        error: `Upstream error ${upstream.status}: ${errText.slice(0, 300)}`,
      }),
      { status: 502, headers: { "Content-Type": "application/json" } }
    );
  }

  return new Response(createStreamResponse(parseAnthropicStream(upstream.body), webhookUrl), {
    headers: SSE_HEADERS,
  });
}
