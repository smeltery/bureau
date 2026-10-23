import { expect, test } from "bun:test";
import { createVoiceRecorder, type RecorderState } from "./recorder.ts";
class Recorder {
  state = "inactive";
  mimeType = "audio/webm";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  start() {
    this.state = "recording";
  }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["clip"]) });
    this.onstop?.();
  }
}
function fixture() {
  const states: RecorderState[] = [],
    transcripts: string[] = [],
    errors: string[] = [];
  let stopped = 0;
  const stream = { getTracks: () => [{ stop: () => stopped++ }] } as unknown as MediaStream;
  const recorder = new Recorder();
  const deps = { getStream: async () => stream, createRecorder: () => recorder as unknown as MediaRecorder, transcribe: async (_blob: Blob, _signal: AbortSignal) => "hello" };
  const controller = createVoiceRecorder({ state: (value) => states.push(value), transcript: (value) => transcripts.push(value), error: (value) => errors.push(value) }, deps);
  return { controller, deps, stream, recorder, states, transcripts, errors, stopped: () => stopped };
}
test("recording releases the microphone before transcription and delivers one result", async () => {
  const f = fixture();
  f.deps.transcribe = async (blob) => {
    expect(f.stopped()).toBeGreaterThan(0);
    expect(blob.type).toBe("audio/webm");
    return "hello";
  };
  await f.controller.start();
  await f.controller.start();
  f.controller.stop();
  await Bun.sleep(0);
  expect(f.transcripts).toEqual(["hello"]);
  expect(f.controller.active()).toBe(false);
  expect(f.states).toContain("transcribing");
});
test("cancellation during permission or transcription discards late work", async () => {
  const permission = fixture();
  let grant!: (stream: MediaStream) => void;
  permission.deps.getStream = () =>
    new Promise((resolve) => {
      grant = resolve;
    });
  const starting = permission.controller.start();
  permission.controller.cancel();
  grant(permission.stream);
  await starting;
  expect(permission.stopped()).toBeGreaterThan(0);
  expect(permission.transcripts).toEqual([]);
  const f = fixture();
  let finish!: (text: string) => void;
  let signal!: AbortSignal;
  f.deps.transcribe = (_blob, abort) => {
    signal = abort;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  await f.controller.start();
  f.controller.stop();
  f.controller.cancel();
  expect(signal.aborted).toBe(true);
  finish("late");
  await Bun.sleep(0);
  expect(f.transcripts).toEqual([]);
});
test("recorder errors release tracks and permit a new recording", async () => {
  const f = fixture();
  await f.controller.start();
  f.recorder.onerror!();
  expect(f.stopped()).toBeGreaterThan(0);
  expect(f.errors).toHaveLength(1);
  expect(f.transcripts).toEqual([]);
  await f.controller.start();
  f.controller.stop();
  await Bun.sleep(0);
  expect(f.transcripts).toEqual(["hello"]);
});
