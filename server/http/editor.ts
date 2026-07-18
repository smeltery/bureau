import * as AgentManager from "../agent-manager.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import type { OpenFileResult } from "../file-editor.ts";
import { canSeeRoom, getUserById } from "../users.ts";
import type { UserRecord } from "../../shared/types.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const CONNECTION_ID_HEADER = "X-Bureau-Connection-Id";

export interface EditorHttpDeps {
  verifyConnection(connectionId: string, sessionIdHash: string): boolean;
  watchFile(agentId: string, absPath: string, connectionId: string, baselineSig?: string): void;
  closeWatch(agentId: string, absPath: string, connectionId: string): void;
}

/**
 * Handle editor HTTP routes:
 *   GET    /api/agents/:id/file?path=...       — read a text file and arm a watcher.
 *   PUT    /api/agents/:id/file                — save a text file with mtime conflict checks.
 *   DELETE /api/agents/:id/file/watch?path=... — close an editor watcher.
 *
 * Returns null for any other URL so the caller can fall through.
 */
export async function handleEditorRequest(req: Request, url: URL, auth: AuthResult | undefined, deps: EditorHttpDeps): Promise<Response | null> {
  const parts = editorRouteParts(url.pathname);
  if (!parts) return null;
  const agentId = parts[1]!;
  const denied = requireUserAgentAccess(auth, agentId);
  if (denied) return denied;

  if (req.method === "GET" && parts.length === 3 && parts[2] === "file") {
    const bind = bindWatchContext(req, url, auth, deps);
    if (!bind.ok) return bind.response;
    const probe = AgentManager.openEditorFile(agentId, bind.path);
    if (!probe.ok) return jsonError(probe.error === "not_agent" ? 404 : 400, probe.error === "not_agent" ? "not_found" : "bad_path", probe.error === "not_agent" ? "agent not found" : "invalid path");
    const result = probe.result;
    if (result.kind !== "ok") return openFileError(result);
    deps.watchFile(agentId, result.path, bind.connectionId, result.sig);
    return new Response(JSON.stringify({ path: result.path, content: result.content, mtime: result.mtime, language: result.language, size: result.size }), {
      headers: JSON_HEADERS,
    });
  }

  if (req.method === "PUT" && parts.length === 3 && parts[2] === "file") {
    const body = await readJsonBody(req);
    if (!body) return jsonError(400, "invalid_json", "invalid JSON body");
    const path = typeof body.path === "string" ? body.path : "";
    if (!path) return jsonError(400, "invalid_path", "path is required");
    if (typeof body.content !== "string") return jsonError(422, "invalid_request", "content must be a string");
    if (typeof body.expectedMtime !== "number" || !Number.isFinite(body.expectedMtime)) {
      return jsonError(422, "invalid_request", "expectedMtime must be a finite number");
    }
    if (body.force !== undefined && typeof body.force !== "boolean") return jsonError(422, "invalid_request", "force must be a boolean");
    const absPath = AgentManager.resolveEditorPathForAgent(agentId, path);
    if (!absPath) return jsonError(404, "not_found", "agent not found");
    const result = AgentManager.saveEditorFile(absPath, body.content, body.expectedMtime, body.force ?? false);
    if (result.kind === "ok") return new Response(JSON.stringify({ ok: true, mtime: result.mtime }), { headers: JSON_HEADERS });
    if (result.kind === "stale") {
      return jsonError(409, "stale", "File changed on disk since you opened it.", { currentMtime: result.currentMtime });
    }
    if (result.kind === "deleted") {
      return jsonError(409, "deleted", "File was deleted on disk.");
    }
    return jsonError(500, "io_error", result.message);
  }

  if (req.method === "DELETE" && parts.length === 4 && parts[2] === "file" && parts[3] === "watch") {
    const bind = bindWatchContext(req, url, auth, deps);
    if (!bind.ok) return bind.response;
    const absPath = AgentManager.resolveEditorPathForAgent(agentId, bind.path);
    if (!absPath) return jsonError(404, "not_found", "agent not found");
    deps.closeWatch(agentId, absPath, bind.connectionId);
    return new Response(null, { status: 204, headers: JSON_HEADERS });
  }

  return null;
}

function bindWatchContext(req: Request, url: URL, auth: AuthResult | undefined, deps: EditorHttpDeps): { ok: true; path: string; connectionId: string } | { ok: false; response: Response } {
  if (auth?.kind !== "ok") return { ok: false, response: jsonError(401, "unauthenticated", "unauthenticated") };
  const path = url.searchParams.get("path") ?? "";
  if (!path) return { ok: false, response: jsonError(400, "invalid_path", "path query parameter is required") };
  const connectionId = req.headers.get(CONNECTION_ID_HEADER) ?? "";
  if (!connectionId) return { ok: false, response: jsonError(400, "missing_connection", `${CONNECTION_ID_HEADER} header is required`) };
  if (!deps.verifyConnection(connectionId, auth.session.sessionIdHash)) {
    return { ok: false, response: jsonError(403, "bad_connection", "That connection does not belong to your session.") };
  }
  return { ok: true, path, connectionId };
}

function openFileError(result: Exclude<OpenFileResult, { kind: "ok" }>): Response {
  switch (result.kind) {
    case "not_found":
      return jsonError(404, "not_found", "file not found");
    case "not_file":
      return jsonError(422, "not_file", "path is not a file");
    case "binary":
      return jsonError(415, "binary", "file appears to be binary");
    case "too_large":
      return jsonError(413, "too_large", "file is too large", { size: result.size });
    case "io_error":
      return jsonError(500, "io_error", result.message);
  }
}

async function readJsonBody(req: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await req.json();
    return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function jsonError(status: number, code: string, message: string, detail?: Record<string, unknown>): Response {
  return new Response(JSON.stringify(detail ? { error: message, code, detail } : { error: message, code }), { status, headers: JSON_HEADERS });
}

function sessionUser(auth: AuthResult | undefined): UserRecord | null {
  if (auth?.kind !== "ok") return null;
  return getUserById(auth.session.userId);
}

function requireUserAgentAccess(auth: AuthResult | undefined, agentId: string): Response | null {
  const agent = AgentManager.getAgent(agentId);
  if (!agent) return jsonError(404, "not_found", "agent not found");
  const user = sessionUser(auth);
  if (!user) return jsonError(401, "unauthenticated", "unauthenticated");
  const roomId = AgentManager.getRooms()[agent.room]?.id;
  if (!roomId || !canSeeRoom(user, roomId)) return jsonError(403, "forbidden", "forbidden");
  return null;
}

function editorRouteParts(pathname: string): string[] | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "agents" || !parts[2]) return null;
  if (parts.length === 4 && parts[3] === "file") return parts.slice(1);
  if (parts.length === 5 && parts[3] === "file" && parts[4] === "watch") return parts.slice(1);
  return null;
}
