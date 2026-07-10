import type { ChildProcessWithoutNullStreams } from "child_process";
import { CODEX_LAUNCH_FAILED_MESSAGE } from "./client-process.ts";

export function attachCodexChildEvents({
  child,
  failAllPending,
  onClose,
  onErrorClosed,
  onExit,
  onStderr,
  onStdout,
  clearKillTimer,
}: {
  child: ChildProcessWithoutNullStreams;
  failAllPending: (reason: string | Error) => void;
  onClose: () => void;
  onErrorClosed: () => void;
  onExit: (code: number | null, signal: NodeJS.Signals | null) => void;
  onStderr: (chunk: string) => void;
  onStdout: (chunk: string) => void;
  clearKillTimer: () => void;
}) {
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");

  child.stdout.on("data", onStdout);
  child.stderr.on("data", onStderr);
  child.on("error", (err: NodeJS.ErrnoException) => {
    onErrorClosed();
    if (err.code === "ENOENT") {
      failAllPending(new Error(CODEX_LAUNCH_FAILED_MESSAGE));
    } else {
      failAllPending(`codex subprocess error: ${err.message}`);
    }
  });
  child.on("exit", (code, signal) => {
    clearKillTimer();
    failAllPending(`codex subprocess exited${code != null ? ` with code ${code}` : ""}${signal ? ` (signal ${signal})` : ""}`);
    onExit(code, signal);
    onClose();
  });
}
