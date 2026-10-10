import { createHash, randomUUID } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, parse, resolve } from "node:path";

export const MAX_SKILL_BYTES = 256 * 1024;
export class SkillError extends Error {
  constructor(
    message: string,
    public status = 400,
  ) {
    super(message);
  }
}
export const digest = (value: string) => createHash("sha256").update(value).digest("hex");
export function absent(error: unknown): boolean {
  return (error as NodeJS.ErrnoException).code === "ENOENT";
}

// Check every existing ancestor, including the root itself. Never follow a
// skill symlink into an unrelated directory, even for reads.
export function safePath(path: string): void {
  const absolute = resolve(path);
  let cursor = parse(absolute).root;
  for (const part of absolute.slice(cursor.length).split("/")) {
    cursor = join(cursor, part);
    try {
      if (lstatSync(cursor).isSymbolicLink()) throw new SkillError("Symbolic links are not editable skills.", 403);
    } catch (error) {
      if (!absent(error)) throw error;
    }
  }
}
export function readDocument(path: string): { content: string; version: string } {
  safePath(path);
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > MAX_SKILL_BYTES) throw new SkillError("Skill must be a text file smaller than 256 KiB.");
    const bytes = readFileSync(fd);
    if (bytes.length > MAX_SKILL_BYTES || bytes.includes(0)) throw new SkillError("Skill must be a text file smaller than 256 KiB.");
    const content = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return { content, version: digest(content) };
  } finally {
    closeSync(fd);
  }
}
export function entries(path: string) {
  safePath(path);
  try {
    const result = readdirSync(path, { withFileTypes: true });
    if (result.length > 2000) throw new SkillError("Skill directory exceeds the 2,000-entry limit.");
    return result;
  } catch (error) {
    if (absent(error)) return [];
    throw error;
  }
}
export function writeDocument(path: string, content: string, version: string | null): void {
  if (typeof content !== "string" || Buffer.byteLength(content) > MAX_SKILL_BYTES || content.includes("\0")) throw new SkillError("Skill must be text smaller than 256 KiB.");
  safePath(path);
  if (version === null) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    safePath(path);
    try {
      writeFileSync(path, content, { flag: "wx", mode: 0o600 });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST") throw new SkillError("A skill with this name already exists.", 409);
      throw error;
    }
    return;
  }
  if (readDocument(path).version !== version) throw new SkillError("Skill changed on disk. Reload before saving.", 409);
  const temporary = join(dirname(path), `.skill-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, content, { flag: "wx", mode: 0o600 });
    safePath(path);
    if (readDocument(path).version !== version) throw new SkillError("Skill changed on disk. Reload before saving.", 409);
    renameSync(temporary, path);
  } finally {
    try {
      unlinkSync(temporary);
    } catch (error) {
      if (!absent(error)) console.error("[skills] Unable to remove temporary file:", error);
    }
  }
}
export function deleteDocument(path: string, version: string): void {
  if (readDocument(path).version !== version) throw new SkillError("Skill changed on disk. Reload before deleting.", 409);
  // Only remove the prompt, never scripts, references, or neighboring assets.
  unlinkSync(path);
}
