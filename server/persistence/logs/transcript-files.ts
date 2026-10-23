import { appendFileSync, existsSync, lstatSync, readFileSync, readdirSync, renameSync, unlinkSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";

export function transcriptName(name: string): { sessionId: string; compressed: boolean } | null {
  const match = /^(?!\.)([^/\\]+)\.jsonl(\.gz)?$/.exec(name);
  return match ? { sessionId: match[1], compressed: !!match[2] } : null;
}

/** A plain file is authoritative if a crash left both representations. */
export function listTranscripts(directory: string) {
  const selected = new Map<string, { name: string; sessionId: string; compressed: boolean; bytes: number; mtimeMs: number }>();
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const parsed = transcriptName(entry.name);
    if (!entry.isFile() || !parsed) continue;
    const previous = selected.get(parsed.sessionId);
    if (previous && !previous.compressed) continue;
    const stat = lstatSync(join(directory, entry.name));
    selected.set(parsed.sessionId, { name: entry.name, ...parsed, bytes: stat.size, mtimeMs: stat.mtimeMs });
  }
  return [...selected.values()];
}

function readRegular(path: string): Buffer {
  if (!lstatSync(path).isFile()) throw new Error("transcript is not a regular file");
  return readFileSync(path);
}

export function readTranscript(directory: string, sessionId: string): Buffer {
  const plain = join(directory, `${sessionId}.jsonl`);
  try {
    return readRegular(plain);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return gunzipSync(readRegular(`${plain}.gz`));
}

/** Publish complete bytes before removing the compressed fallback. */
export function appendTranscript(directory: string, sessionId: string, line: string): void {
  const plain = join(directory, `${sessionId}.jsonl`);
  const compressed = `${plain}.gz`;
  if (!existsSync(plain) && existsSync(compressed)) {
    const bytes = gunzipSync(readRegular(compressed));
    const temporary = `${plain}.${crypto.randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, Buffer.concat([bytes, Buffer.from(line)]), { flag: "wx", mode: 0o600 });
      renameSync(temporary, plain);
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
  } else appendFileSync(plain, line);
  if (existsSync(compressed)) unlinkSync(compressed);
}

/** Delete the fallback first so a partial deletion cannot resurrect old entries. */
export function deleteTranscript(path: string): number {
  let bytes = lstatSync(path).size;
  if (path.endsWith(".jsonl") && existsSync(`${path}.gz`)) {
    bytes += lstatSync(`${path}.gz`).size;
    unlinkSync(`${path}.gz`);
  }
  unlinkSync(path);
  return bytes;
}

export function publishCompressed(path: string, bytes: Buffer, mtimeMs: number): void {
  const temporary = `${path}.${crypto.randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, bytes, { flag: "wx", mode: 0o600 });
    utimesSync(temporary, mtimeMs / 1000, mtimeMs / 1000);
    renameSync(temporary, `${path}.gz`);
    unlinkSync(path);
  } finally {
    if (existsSync(temporary)) unlinkSync(temporary);
  }
}
