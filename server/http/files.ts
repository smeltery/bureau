import type { Attachment } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import { mimeTypeForFilename } from "../mime-types.ts";
import { getFilePath, saveFile } from "../persistence.ts";

const JSON_HEADERS = { "Content-Type": "application/json" };

/**
 * Handle /api/upload/{agentId} (POST) and /api/files/{agentId}/{filename}
 * (GET, with legacy /api/images/ alias). Returns null for any other URL so
 * the caller can fall through.
 */
export async function handleFilesRequest(req: Request, url: URL): Promise<Response | null> {
  // Upload
  if (url.pathname.startsWith("/api/upload/") && req.method === "POST") {
    return uploadHandler(req, url);
  }

  // Serve
  if (url.pathname.startsWith("/api/files/") || url.pathname.startsWith("/api/images/")) {
    return serveHandler(url);
  }

  return null;
}

async function uploadHandler(req: Request, url: URL): Promise<Response> {
  const agentId = url.pathname.split("/")[3];
  if (!agentId || !AgentManager.getAgent(agentId)) {
    return new Response(JSON.stringify({ error: "agent not found" }), {
      status: 404,
      headers: JSON_HEADERS,
    });
  }
  try {
    const formData = await req.formData();
    const attachments: Attachment[] = [];
    const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
    const MAX_FILES = 5;
    const MAX_TOTAL = 40 * 1024 * 1024; // 40MB
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
        return new Response(JSON.stringify({ error: `File "${value.name}" exceeds 20MB limit` }), {
          status: 400,
          headers: JSON_HEADERS,
        });
      }
      totalSize += value.size;
      if (totalSize > MAX_TOTAL) {
        return new Response(JSON.stringify({ error: "Total upload exceeds 40MB limit" }), {
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

function serveHandler(url: URL): Response {
  const parts = url.pathname.split("/").filter(Boolean); // ["api", "files"|"images", agentId, filename]
  const agentId = parts[2];
  const filename = parts[3];
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
