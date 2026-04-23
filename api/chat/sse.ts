import { logBotMessageToDiscord } from "./discord";

export const SSE_HEADERS = {
  "Content-Type": "text/event-stream",
  "Cache-Control": "no-cache",
  Connection: "keep-alive",
};

function enqueueSseData(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder,
  payload: unknown
): void {
  controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
}

function enqueueSseDone(
  controller: ReadableStreamDefaultController<Uint8Array>,
  encoder: TextEncoder
): void {
  controller.enqueue(encoder.encode("data: [DONE]\n\n"));
}

export function createStreamResponse(
  stream: AsyncIterable<any>,
  webhookUrl?: string
): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      let fullText = "";
      try {
        for await (const event of stream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            fullText += event.delta.text;
            enqueueSseData(controller, encoder, { text: event.delta.text });
          }
        }

        // Log bot response to Discord before closing the stream
        // (Vercel Edge tears down after close, so fire-and-forget wouldn't complete)
        await logBotMessageToDiscord(webhookUrl, fullText);
        enqueueSseDone(controller, encoder);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Unknown error";
        enqueueSseData(controller, encoder, { error: msg });
      } finally {
        controller.close();
      }
    },
  });
}
