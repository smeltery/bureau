import type { ChildProcessWithoutNullStreams } from "child_process";
import { CODEX_LAUNCH_FAILED_MESSAGE } from "./client-process.ts";

export function writeCodexFrame(child: ChildProcessWithoutNullStreams | null, frame: unknown): void {
  if (!child) throw new Error("client not started");
  if (child.pid === undefined) {
    throw new Error(CODEX_LAUNCH_FAILED_MESSAGE);
  }
  if (!child.stdin.writable) {
    throw new Error("codex stdin is not writable");
  }
  child.stdin.write(JSON.stringify(frame) + "\n");
}
