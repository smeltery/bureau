import { expect, test } from "bun:test";
import { readAloud, speechChunks } from "./playback.ts";
import { VoiceError, voiceFailure, voiceFailureText } from "./errors.ts";
import { translatorFor } from "../../shared/i18n/translate.ts";
test("read aloud splits long text without dropping words or splitting surrogate pairs", () => {
  const text = "hello ".repeat(2000).trim();
  const chunks = speechChunks(text);
  expect(chunks.every((chunk) => chunk.length <= 4096)).toBe(true);
  expect(chunks.join(" ")).toBe(text);
  const unicode = "a".repeat(4095) + "😀end";
  expect(speechChunks(unicode).join("")).toBe(unicode);
  expect(speechChunks(unicode)[0]).toHaveLength(4095);
});
test("read aloud requests one chunk at a time and stops further spending after cancellation", async () => {
  const abort = new AbortController();
  let requests = 0,
    played = 0;
  const fetcher = (async () => {
    requests++;
    return new Response("audio");
  }) as unknown as unknown as typeof fetch;
  await expect(
    readAloud("hello ".repeat(2000), "marin", abort.signal, fetcher, async () => {
      played++;
      abort.abort();
    }),
  ).rejects.toThrow();
  expect(requests).toBe(1);
  expect(played).toBe(1);
});

test("read-aloud failures translate only client-owned fallback text", async () => {
  for (const error of ["", "Original provider error {value}"]) {
    const fetcher = (async () => Response.json({ error }, { status: 503 })) as unknown as typeof fetch;
    let played = false;
    const caught = await readAloud("Original text", "marin", new AbortController().signal, fetcher, async () => {
      played = true;
    }).catch((failure: unknown) => failure);
    expect(played).toBe(false);
    expect(caught instanceof VoiceError).toBe(!error);
    const failure = voiceFailure(caught, "voice.readFailed");
    for (const language of ["en", "es", "ca", "zh"] as const) {
      const { t } = translatorFor(language);
      expect(voiceFailureText(failure, t)).toBe(error || t("voice.readFailedHint"));
    }
  }
});
