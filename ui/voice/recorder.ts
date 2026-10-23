import { MAX_VOICE_AUDIO_BYTES, MAX_VOICE_RECORDING_MS } from "../../shared/integrations/voice.ts";

export type RecorderState = "idle" | "requesting" | "recording" | "transcribing";
export interface RecorderDeps {
  getStream(): Promise<MediaStream>;
  createRecorder(stream: MediaStream): MediaRecorder;
  transcribe(blob: Blob, signal: AbortSignal): Promise<string>;
}
type RecordingRun = { recorder?: MediaRecorder; stream?: MediaStream; abort: AbortController; timer?: ReturnType<typeof setTimeout>; phase: RecorderState };
export function createVoiceRecorder(callbacks: { state(value: RecorderState): void; transcript(value: string): void; error(value: string): void }, deps: RecorderDeps) {
  let current: RecordingRun | null = null;
  function release(run: RecordingRun) {
    clearTimeout(run.timer);
    run.stream?.getTracks().forEach((track) => track.stop());
  }
  function cancel() {
    const run = current;
    if (!run) return;
    current = null;
    run.abort.abort();
    if (run.recorder && run.recorder.state !== "inactive") run.recorder.stop();
    release(run);
    callbacks.state("idle");
  }
  function fail(run: RecordingRun, message: string) {
    if (current !== run) return;
    cancel();
    callbacks.error(message);
  }
  function stop() {
    const run = current;
    if (!run) return;
    if (run.phase !== "recording") {
      cancel();
      return;
    }
    run.phase = "transcribing";
    callbacks.state(run.phase);
    run.recorder?.stop();
    release(run);
  }
  async function start() {
    if (current) return;
    const run: RecordingRun = { abort: new AbortController(), phase: "requesting" };
    current = run;
    callbacks.state(run.phase);
    try {
      run.stream = await deps.getStream();
      if (current !== run) {
        release(run);
        return;
      }
      const recorder = (run.recorder = deps.createRecorder(run.stream));
      const chunks: Blob[] = [];
      let size = 0;
      recorder.ondataavailable = (event) => {
        if (current !== run || !event.data.size) return;
        size += event.data.size;
        if (size > MAX_VOICE_AUDIO_BYTES) {
          fail(run, "Recording is too large. Try a shorter clip.");
          return;
        }
        chunks.push(event.data);
      };
      recorder.onerror = () => fail(run, "Microphone recording failed. Please try again.");
      recorder.onstop = async () => {
        release(run);
        if (current !== run) return;
        run.phase = "transcribing";
        callbacks.state(run.phase);
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType || chunks[0]?.type });
          if (!blob.size) {
            fail(run, "No audio was recorded. Try speaking for longer.");
            return;
          }
          const transcript = await deps.transcribe(blob, run.abort.signal);
          if (current !== run) return;
          callbacks.transcript(transcript);
          current = null;
          callbacks.state("idle");
        } catch (error) {
          fail(run, error instanceof Error ? error.message : "Transcription failed.");
        }
      };
      recorder.start(250);
      run.phase = "recording";
      callbacks.state(run.phase);
      run.timer = setTimeout(stop, MAX_VOICE_RECORDING_MS);
    } catch (error) {
      const name = error instanceof Error ? error.name : "";
      fail(
        run,
        name === "NotAllowedError"
          ? "Microphone permission was denied. Allow microphone access and try again."
          : name === "NotFoundError"
            ? "No microphone was found."
            : "Could not start microphone recording.",
      );
    }
  }
  return { start, stop, cancel, active: () => current !== null };
}
export const browserRecorderDeps: RecorderDeps = {
  getStream: () => navigator.mediaDevices.getUserMedia({ audio: true }),
  createRecorder: (stream) => {
    const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/webm"].find((type) => MediaRecorder.isTypeSupported(type));
    if (!mimeType) throw new Error("No supported recording format.");
    return new MediaRecorder(stream, { mimeType });
  },
  transcribe: async (blob, signal) => {
    const response = await fetch("/api/voice/transcribe", { method: "POST", body: blob, signal, credentials: "same-origin" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || "Transcription failed.");
    if (typeof data.text !== "string") throw new Error("Invalid transcription response.");
    return data.text;
  },
};
