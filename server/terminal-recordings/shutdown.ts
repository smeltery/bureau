import { closeAllRecordings } from "./store.ts";

export function installRecordingShutdown() {
  process.once("exit", closeAllRecordings);
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.once(signal, () => {
      closeAllRecordings();
      // Restore the signal's usual exit behavior after flushing synchronous writes.
      process.kill(process.pid, signal);
    });
  }
}
