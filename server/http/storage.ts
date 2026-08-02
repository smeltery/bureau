import type { AuthResult } from "../auth/auth-middleware.ts";
import { getBackupStatus } from "../backup.ts";
import { BUREAU_DIR } from "../persistence/paths.ts";
import { measureStorage } from "../storage-usage.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export function handleStorageRequest(req: Request, url: URL, auth: AuthResult | undefined): Response | null {
  if (url.pathname !== "/api/storage/usage") return null;
  if (req.method !== "GET") return jsonError(405, "method not allowed");
  if (auth?.kind !== "ok") return jsonError(401, "unauthenticated");
  if (auth.session.role !== "owner") return jsonError(403, "owner access required");

  const backup = getBackupStatus();
  return new Response(JSON.stringify(measureStorage({ stateRoot: BUREAU_DIR, backupDir: backup.backupDir })), { headers: JSON_HEADERS });
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}
