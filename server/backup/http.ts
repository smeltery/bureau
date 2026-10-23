import type { AuthResult } from "../auth/auth-middleware.ts";
import { getUserById } from "../users.ts";
import { BackupSettingsError, readBackupSettings, saveBackupSettings } from "./settings.ts";

export async function handleBackupSettingsRequest(req: Request, auth: AuthResult | undefined): Promise<Response> {
  if (auth?.kind !== "ok") return Response.json({ error: "browser session required" }, { status: 401 });
  const isOwner = () => getUserById(auth.session.userId)?.role === "owner";
  if (!isOwner()) return Response.json({ error: "owner access required" }, { status: 403 });
  if (req.method !== "GET" && req.method !== "PATCH") return new Response(null, { status: 405, headers: { Allow: "GET, PATCH" } });
  try {
    if (req.method === "GET") return Response.json(readBackupSettings(), { headers: { "Cache-Control": "no-store" } });
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return Response.json({ error: "invalid JSON" }, { status: 400 });
    }
    if (!isOwner()) return Response.json({ error: "owner access required" }, { status: 403 });
    return Response.json(saveBackupSettings(body), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof BackupSettingsError) return Response.json({ error: error.message }, { status: 400 });
    console.error("[backup] settings request failed:", error);
    return Response.json({ error: "Backup settings could not be read or saved. Check the directory permissions and server log." }, { status: 500 });
  }
}
