import { closeSync, openSync, readSync, statSync } from "fs";
import { join } from "path";
import { claudeProjectDir } from "./paths.ts";

// Bytes read from the END of a Claude session .jsonl. Entries are one JSON
// object per line and we only need the last one; 256 KB is far past any
// realistic final entry, and the window deliberately cuts earlier lines in
// half because we never look at them.
const CLAUDE_SESSION_TAIL_BYTES = 256 * 1024;

// Best-effort: is this session's last transcript entry marked as interrupted by
// a shutdown? The Claude CLI stamps `interruptedByShutdown` when a SIGTERM cuts
// a turn short, on the same entry whose tool result claims the USER rejected the
// running tool. That hardcoded wording is indistinguishable from a real denial
// to the resumed agent, so a true answer here lets the wake-up message say
// categorically that no human rejected anything.
//
// Deliberately NON-LOAD-BEARING: any doubt at all — missing file, unreadable
// tail, unparseable line, marker absent — returns false, and the caller falls
// back to wording that is true either way. This never guesses true.
export function claudeSessionInterruptedByShutdown(cwd: string, sessionId: string, env?: { [key: string]: string | undefined }): boolean {
  const path = join(claudeProjectDir(cwd, env), `${sessionId}.jsonl`);
  let tail: string;
  try {
    const { size } = statSync(path);
    const window = Math.min(size, CLAUDE_SESSION_TAIL_BYTES);
    const fd = openSync(path, "r");
    try {
      const buf = Buffer.alloc(window);
      const n = readSync(fd, buf, 0, window, size - window);
      tail = buf.subarray(0, n).toString("utf8");
    } finally {
      closeSync(fd);
    }
  } catch {
    return false;
  }
  const lines = tail.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i]!.trim();
    if (!line) continue;
    try {
      const parsed = JSON.parse(line) as { interruptedByShutdown?: unknown };
      return parsed?.interruptedByShutdown === true;
    } catch {
      // The last non-empty line isn't valid JSON: either a mid-write capture
      // or a line longer than the window. Indeterminate, so stay hedged.
      return false;
    }
  }
  return false;
}
