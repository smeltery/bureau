import { createHash } from "node:crypto";

/** Stable across credential rotations and changes to the configured env file. */
export function openCodeEnvironmentId(userId?: string | null, roomId?: string | null): string {
  return JSON.stringify([userId ?? null, roomId ?? null]);
}

export function profileKey(environmentId: string): string {
  return createHash("sha256").update(environmentId).digest("hex");
}
