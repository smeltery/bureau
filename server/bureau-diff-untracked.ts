import type { DiffFileSummary } from "../shared/types.ts";
import { closeSync, openSync, readSync, statSync } from "fs";
import { join } from "path";

const UNTRACKED_MAX_BYTES = 1_000_000;

export function synthesizeUntrackedPatches(cwd: string, untracked: string[], fileMap: Map<string, DiffFileSummary>): string[] {
  const patches: string[] = [];
  for (const path of untracked) {
    const probe = probeUntracked(join(cwd, path));
    if (probe.kind === "error") continue;
    if (probe.kind === "binary") {
      fileMap.set(path, { path, status: "binary", additions: 0, deletions: 0, lineCount: 0, inlineEligible: false });
      continue;
    }
    if (probe.kind === "tooLarge") {
      // Re-use "untracked" status to flag "we saw it but didn't synthesize"
      // - the overlay surfaces a friendly explanation.
      fileMap.set(path, { path, status: "untracked", additions: 0, deletions: 0, lineCount: 0, inlineEligible: false });
      continue;
    }
    const content = probe.content!;
    const lines = content === "" ? [] : content.split("\n");
    const trailingNewline = content.endsWith("\n");
    const realLines = trailingNewline ? lines.slice(0, -1) : lines;
    const additions = realLines.length;
    const header = [`diff --git a/${path} b/${path}`, "new file mode 100644", "--- /dev/null", `+++ b/${path}`, `@@ -0,0 +1,${additions} @@`];
    const body = realLines.map((line) => `+${line}`);
    if (!trailingNewline && realLines.length > 0) body.push("\\ No newline at end of file");
    patches.push([...header, ...body].join("\n"));
    fileMap.set(path, { path, status: "added", additions, deletions: 0, lineCount: additions, inlineEligible: false });
  }
  return patches;
}

function probeUntracked(abs: string): { kind: "binary" | "tooLarge" | "ok" | "error"; content?: string } {
  let fd: number | null = null;
  try {
    fd = openSync(abs, "r");
    const probe = Buffer.alloc(8192);
    const read = readSync(fd, probe, 0, 8192, 0);
    for (let i = 0; i < read; i++) if (probe[i] === 0) return { kind: "binary" };
    const st = statSync(abs);
    if (st.size > UNTRACKED_MAX_BYTES) return { kind: "tooLarge" };
    if (st.size <= read) return { kind: "ok", content: probe.subarray(0, st.size).toString("utf8") };
    const buf = Buffer.alloc(st.size);
    probe.copy(buf, 0, 0, read);
    let off = read;
    while (off < st.size) {
      const r = readSync(fd, buf, off, st.size - off, off);
      if (r === 0) break;
      off += r;
    }
    return { kind: "ok", content: buf.subarray(0, off).toString("utf8") };
  } catch {
    return { kind: "error" };
  } finally {
    if (fd !== null)
      try {
        closeSync(fd);
      } catch {}
  }
}
