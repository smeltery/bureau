import { closeSync, constants, openSync, readFileSync, writeSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFileSync, BUREAU_DIR } from "../persistence/paths.ts";
import type { RecordingEvent, RecordingHeader, RecordingStatus } from "../../shared/terminal/recordings.ts";
import { MAX_RECORDING_BYTES, recordingPath, safeDirectory } from "./files.ts";
import { createRecordingRedactor } from "./redaction.ts";

function writeAll(fd: number, data: Buffer) {
  let written = 0;
  while (written < data.length) {
    const count = writeSync(fd, data, written);
    if (!count) throw new Error("Recording write made no progress");
    written += count;
  }
}

export function recordingEnabled(root = BUREAU_DIR): boolean {
  try {
    const settings = JSON.parse(readFileSync(join(root, "terminal-recording-settings.json"), "utf8"));
    if (typeof settings.enabled !== "boolean") throw new Error("Invalid recording settings");
    return settings.enabled;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
export function saveRecordingEnabled(enabled: boolean, root = BUREAU_DIR) {
  atomicWriteFileSync(join(root, "terminal-recording-settings.json"), JSON.stringify({ enabled }));
  if (!enabled) for (const recording of active.values()) if (recording.root === root) recording.close("disabled");
}
interface Recording {
  id: string;
  root: string;
  output(data: string): void;
  resize(cols: number, rows: number): void;
  input(actor: string): void;
  close(reason: string): void;
}
const active = new Map<string, Recording>();
export const isRecordingActive = (id: string) => active.has(id);
export function closeAllRecordings() {
  for (const recording of active.values()) recording.close("server stopped");
}

export function startRecording(agentId: string, roomId: string, status: (value: RecordingStatus) => void, root = BUREAU_DIR, now = Date.now): Recording | null {
  let fd: number | undefined;
  try {
    if (!recordingEnabled(root)) {
      status("off");
      return null;
    }
    safeDirectory(root, true);
    const id = crypto.randomUUID();
    fd = openSync(recordingPath(id, root), constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    const startedAt = now();
    const header: RecordingHeader = { version: 1, id, agentId, roomId, startedAt, cols: 80, rows: 24 };
    const firstLine = JSON.stringify(header) + "\n";
    writeAll(fd, Buffer.from(firstLine));
    let bytes = Buffer.byteLength(firstLine);
    let closed = false;
    let lastActor = "";
    let lastInput = 0;
    let outputSinceInput = false;
    let queued = "";
    const elapsed = () => Math.max(0, now() - startedAt);
    const flush = () => {
      if (closed || !queued) return;
      try {
        writeAll(fd!, Buffer.from(queued));
        queued = "";
      } catch {
        stop("error");
      }
    };
    const timer = setInterval(flush, 250);
    timer.unref();
    function stop(value: RecordingStatus) {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      active.delete(id);
      try {
        closeSync(fd!);
      } catch {
        /* The terminal remains usable after recording failure. */
      }
      status(value);
    }
    function append(event: RecordingEvent) {
      if (closed) return;
      const line = JSON.stringify(event) + "\n";
      const size = Buffer.byteLength(line);
      if (bytes + size > MAX_RECORDING_BYTES - 1024) {
        queued += JSON.stringify({ type: "end", at: elapsed(), reason: "size limit reached" }) + "\n";
        flush();
        stop("stopped");
        return;
      }
      bytes += size;
      queued += line;
      if (queued.length >= 65536) flush();
    }
    const redactor = createRecordingRedactor((data) => append({ type: "output", at: elapsed(), data }));
    const recording: Recording = {
      id,
      root,
      output(data) {
        if (!closed) {
          outputSinceInput = true;
          redactor.push(data);
        }
      },
      resize(cols, rows) {
        if (Number.isInteger(cols) && Number.isInteger(rows) && cols > 0 && cols <= 1000 && rows > 0 && rows <= 1000) append({ type: "resize", at: elapsed(), cols, rows });
      },
      input(actor) {
        if (closed) return;
        const at = elapsed();
        if (actor !== lastActor || (outputSinceInput && at - lastInput > 2000)) append({ type: "typist", at, actor });
        lastActor = actor;
        lastInput = at;
        outputSinceInput = false;
      },
      close(reason) {
        if (closed) return;
        redactor.finish();
        append({ type: "end", at: elapsed(), reason });
        flush();
        stop("stopped");
      },
    };
    active.set(id, recording);
    status("recording");
    return recording;
  } catch {
    if (fd !== undefined)
      try {
        closeSync(fd);
      } catch {
        /* Already closed. */
      }
    console.error("[terminal] recording could not start");
    status("error");
    return null;
  }
}
