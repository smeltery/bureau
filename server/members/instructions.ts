import { createHash } from "node:crypto";
import type { UserRecord } from "../../shared/types.ts";

export function instructionVersion(prompt: string | null): string {
  return createHash("sha256")
    .update(prompt ?? "")
    .digest("hex");
}

export function instructionSnapshot(user: UserRecord) {
  return { memberPrompt: user.memberPrompt, memberPromptVersion: instructionVersion(user.memberPrompt) };
}

export function instructionConflict(user: UserRecord, changes: { memberPrompt?: unknown; memberPromptVersion?: unknown }): string | null {
  if (changes.memberPrompt === undefined) return null;
  if (changes.memberPrompt !== null && typeof changes.memberPrompt !== "string") return "memberPrompt must be a string or null";
  if (typeof changes.memberPrompt === "string" && Buffer.byteLength(changes.memberPrompt) > 64 * 1024) return "memberPrompt exceeds 64 KiB";
  if (typeof changes.memberPromptVersion !== "string" || !changes.memberPromptVersion) return "memberPromptVersion is required";
  return changes.memberPromptVersion === instructionVersion(user.memberPrompt) ? null : "version conflict: instructions changed; read the current text before retrying";
}
