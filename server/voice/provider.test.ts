import { expect, test } from "bun:test";
import { transcribeAudio } from "./transcribe.ts";
import { speakText, type VoiceSocket } from "./speak.ts";
import { readVoiceBytes } from "./limits.ts";

test("transcription sends a bounded file to the fixed endpoint and never exposes provider errors", async () => {
  const fetcher = (async (url: string, init: RequestInit) => {
    expect(url).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init.redirect).toBe("error");
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer private-key");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("gpt-transcribe");
    expect((form.get("file") as File).name).toBe("recording.webm");
    return Response.json({ text: "hello" });
  }) as unknown as typeof fetch;
  expect(await transcribeAudio(new Uint8Array([1]), "audio/webm", "private-key", new AbortController().signal, fetcher)).toBe("hello");
  await expect(
    transcribeAudio(new Uint8Array([1]), "audio/webm", "private-key", new AbortController().signal, (async () => new Response("private-key", { status: 401 })) as unknown as typeof fetch),
  ).rejects.toThrow("Check your voice credential");
});
class Socket extends EventTarget implements VoiceSocket {
  sent: any[] = [];
  closed = false;
  send(value: string | ArrayBufferLike | Blob | ArrayBufferView) {
    this.sent.push(JSON.parse(value as string));
  }
  close() {
    this.closed = true;
  }
  event(value: unknown) {
    this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify(value) }));
  }
}
function speech() {
  const socket = new Socket();
  const abort = new AbortController();
  const result = speakText("Hello", "cedar", "private-key", abort.signal, () => socket);
  socket.dispatchEvent(new Event("open"));
  return { socket, abort, result };
}
test("read aloud configures audio before requesting speech and wraps complete PCM in WAV", async () => {
  const { socket, result } = speech();
  expect(socket.sent[0]).toMatchObject({ type: "session.update", session: { audio: { output: { voice: "cedar", format: { type: "audio/pcm", rate: 24000 } } } } });
  expect(socket.sent).toHaveLength(1);
  socket.event({ type: "session.updated" });
  socket.event({ type: "session.updated" });
  expect(socket.sent).toHaveLength(2);
  expect(socket.sent[1].response).toMatchObject({ conversation: "none", input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Hello" }] }], tools: [] });
  socket.event({ type: "response.output_audio.delta", delta: Buffer.from([1, 2, 3, 4]).toString("base64") });
  socket.event({ type: "response.done", response: { status: "completed" } });
  const wave = await result;
  expect(new TextDecoder().decode(wave.slice(0, 4))).toBe("RIFF");
  expect(new DataView(wave.buffer).getUint32(24, true)).toBe(24000);
  expect([...wave.slice(44)]).toEqual([1, 2, 3, 4]);
  expect(socket.closed).toBe(true);
});
test("read aloud rejects interrupted, malformed, or failed output and closes on cancellation", async () => {
  for (const event of [
    { type: "error", error: { message: "private-key" } },
    { type: "response.done", response: { status: "incomplete" } },
    { type: "response.output_audio.delta", delta: "!!!" },
  ]) {
    const { socket, result } = speech();
    socket.event(event);
    await expect(result).rejects.toThrow("could not generate speech");
    expect(socket.closed).toBe(true);
  }
  const { abort, socket, result } = speech();
  abort.abort();
  await expect(result).rejects.toThrow("cancelled");
  expect(socket.closed).toBe(true);
});
test("bounded voice reads cancel oversize and stalled streams", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(10));
    },
    cancel() {
      cancelled = true;
    },
  });
  await expect(readVoiceBytes(body, 2, new AbortController().signal)).rejects.toThrow("too large");
  expect(cancelled).toBe(true);
  const stalled = new ReadableStream<Uint8Array>();
  const abort = new AbortController();
  const result = readVoiceBytes(stalled, 10, abort.signal);
  abort.abort();
  await expect(result).rejects.toThrow();
});
