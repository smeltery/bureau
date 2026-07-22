import type { BackupStatus } from "../backup.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import type { VersionInfo } from "../version.ts";

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
  getVersion(): VersionInfo;
}

/**
 * Handle system HTTP routes:
 *   GET /api/backup/status — normalized backup health for signed-in users.
 *   GET /api/version — build identity for signed-in users and local agents.
 *
 * Returns null for any other URL so the caller can fall through.
 */
export function handleSystemRequest(req: Request, url: URL, auth: AuthResult | undefined, deps: SystemHttpDeps): Response | null {
  if (req.method !== "GET") return null;

  if (url.pathname === "/api/backup/status") {
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

  if (url.pathname === "/api/version") {
    if (auth?.kind !== "ok" && auth?.kind !== "loopback") return jsonError(401, "unauthenticated");
    return new Response(JSON.stringify(deps.getVersion()), { headers: JSON_HEADERS });
  }

  return null;
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}
