import type { Attachment } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import type { AuthResult } from "../auth/auth-middleware.ts";
import { mimeTypeForFilename } from "../mime-types.ts";
import { getFilePath, saveFile } from "../persistence.ts";
import { canSeeRoom, getUserById } from "../users.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Handle /api/upload/{agentId} (POST), /api/files/{agentId}/{filename}
 * (GET, with legacy /api/images/ alias), and browser-facing aliases under
 * /api/agents/{agentId}/uploads and /api/agents/{agentId}/files/{filename}.
 * Returns null for any other URL so the caller can fall through.
 */
export async function handleFilesRequest(req: Request, url: URL, auth?: AuthResult): Promise<Response | null> {
  const agentFileRoute = agentFileRouteParts(url.pathname);
  if (agentFileRoute) {
    const [agentId, action, filename] = agentFileRoute;
    const denied = requireUserAgentAccess(auth, agentId);
    if (denied) return denied;
    if (action === "uploads" && req.method === "POST") return uploadHandler(req, agentId);
    if (action === "files" && req.method === "GET" && filename) return serveHandler(agentId, filename);
    return null;
  }

  // Upload
  if (url.pathname.startsWith("/api/upload/") && req.method === "POST") {
    const denied = requireBrowserSession(auth);
    if (denied) return denied;
    return uploadHandler(req, url.pathname.split("/")[3]);
  }

  // Serve
  if (url.pathname.startsWith("/api/files/") || url.pathname.startsWith("/api/images/")) {
    const denied = requireBrowserSession(auth);
    if (denied) return denied;
    const parts = url.pathname.split("/").filter(Boolean); // ["api", "files"|"images", agentId, filename]
    return serveHandler(parts[2], parts[3]);
  }

  return null;
}

async function uploadHandler(req: Request, agentId: string | undefined): Promise<Response> {
  if (!agentId || !AgentManager.getAgent(agentId)) {
    return new Response(JSON.stringify({ error: "agent not found" }), {
      status: 404,
      headers: JSON_HEADERS,
    });
  }
  try {
    const formData = await req.formData();
    const attachments: Attachment[] = [];
    const MAX_FILE_SIZE = 200 * 1024 * 1024; // 200MB
    const MAX_FILES = 5;
    const MAX_TOTAL = 400 * 1024 * 1024; // 400MB
    let totalSize = 0;
    let fileCount = 0;

    for (const [, value] of formData) {
      if (!(value instanceof File)) continue;
      fileCount++;
      if (fileCount > MAX_FILES) {
        return new Response(JSON.stringify({ error: `Maximum ${MAX_FILES} files per upload` }), {
          status: 400,
          headers: JSON_HEADERS,
        });
      }
      if (value.size > MAX_FILE_SIZE) {
        return new Response(JSON.stringify({ error: `File "${value.name}" exceeds 200MB limit` }), {
          status: 400,
          headers: JSON_HEADERS,
        });
      }
      totalSize += value.size;
      if (totalSize > MAX_TOTAL) {
        return new Response(JSON.stringify({ error: "Total upload exceeds 400MB limit" }), {
          status: 400,
          headers: JSON_HEADERS,
        });
      }
      const buffer = Buffer.from(await value.arrayBuffer());
      const att = saveFile(agentId, buffer, value.type || "application/octet-stream", value.name);
      if (att) attachments.push(att);
    }
    return new Response(JSON.stringify({ attachments }), { headers: JSON_HEADERS });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || "Upload failed" }), {
      status: 500,
      headers: JSON_HEADERS,
    });
  }
}

function serveHandler(agentId: string | undefined, filename: string | undefined): Response {
  if (!agentId || !filename) {
    return new Response("Not found", { status: 404 });
  }
  const filePath = getFilePath(agentId, filename);
  if (!filePath) {
    return new Response("Not found", { status: 404 });
  }
  return new Response(Bun.file(filePath), {
    headers: {
      "Content-Type": mimeTypeForFilename(filename),
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

function requireBrowserSession(auth: AuthResult | undefined): Response | null {
  if (auth?.kind === "ok") return null;
  return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: JSON_HEADERS });
}

function requireUserAgentAccess(auth: AuthResult | undefined, agentId: string): Response | null {
  const agent = AgentManager.getAgent(agentId);
  if (!agent) return new Response(JSON.stringify({ error: "agent not found" }), { status: 404, headers: JSON_HEADERS });
  if (auth?.kind !== "ok") return new Response(JSON.stringify({ error: "unauthenticated" }), { status: 401, headers: JSON_HEADERS });
  const user = getUserById(auth.session.userId);
  const roomId = AgentManager.getRooms()[agent.room]?.id;
  if (!user || !roomId || !canSeeRoom(user, roomId)) return new Response(JSON.stringify({ error: "forbidden" }), { status: 403, headers: JSON_HEADERS });
  return null;
}

function agentFileRouteParts(pathname: string): [agentId: string, action: "uploads" | "files", filename?: string] | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "agents" || !parts[2]) return null;
  if (parts.length === 4 && parts[3] === "uploads") return [parts[2], "uploads"];
  if (parts.length === 5 && parts[3] === "files") return [parts[2], "files", parts[4]];
  return null;
}
