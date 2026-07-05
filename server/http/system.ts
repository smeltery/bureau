import type { BackupStatus } from "../backup.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };

export interface BackupStatusWire {
  lastRunAt: number | null;
  ok: boolean;
  error: string | null;
  retention: number;
  destDir: string;
}

export interface SystemHttpDeps {
  getBackupStatus(): BackupStatus;
}

/**
 * Handle system HTTP routes:
 *   GET /api/backup/status — normalized backup health for signed-in users.
 *
 * Returns null for any other URL so the caller can fall through.
 */
export function handleSystemRequest(req: Request, url: URL, auth: AuthResult | undefined, deps: SystemHttpDeps): Response | null {
  if (url.pathname !== "/api/backup/status" || req.method !== "GET") return null;
  if (auth?.kind !== "ok") return jsonError(401, "unauthenticated");
  const status = deps.getBackupStatus();
  const wire: BackupStatusWire = {
    lastRunAt: status.lastBackupAt,
    ok: status.lastBackupOk ?? false,
    error: status.lastBackupError,
    retention: status.retention,
    destDir: status.backupDir,
  };
  return new Response(JSON.stringify(wire), { headers: JSON_HEADERS });
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}
