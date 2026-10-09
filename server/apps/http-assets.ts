import * as AgentManager from "../agent-manager.ts";
import { readThumbnailFile } from "./media/thumbnail-file.ts";
import type { AppRecord } from "../../shared/apps.ts";
import type { AppsDeps } from "../http/apps-seam.ts";
import { appToWire, jsonError, manageableApp, visibleApp, type AppsIdentity } from "../http/app-route-helpers.ts";
import { boundedBody } from "../http/body/bounded.ts";
import { deleteThumbnail, readThumbnail, saveThumbnail, THUMBNAIL_LIMIT } from "./thumbnails.ts";

export async function handleAppAssetsRequest(req: Request, parts: string[], identity: AppsIdentity, deps: AppsDeps, announce: (record: AppRecord) => void): Promise<Response | null> {
  if (parts.length !== 4 || !["thumbnail", "archive", "restore"].includes(parts[3]!)) return null;
  const app = (req.method === "GET" ? visibleApp : manageableApp)(deps.registry.get(parts[2]!, true), identity);
  if (!app) return jsonError(404, "not_found", "no app has that name");
  if (parts[3] === "thumbnail") {
    if (req.method === "GET") {
      const bytes = readThumbnail(app);
      return bytes
        ? new Response(Uint8Array.from(bytes), {
            headers: { "Content-Type": "image/png", "Cache-Control": "private, no-cache", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "sandbox" },
          })
        : new Response(null, { status: 404 });
    }
    if (req.method === "PUT") {
      const fromPath = req.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
      if (fromPath && identity.scope !== "agent") return jsonError(403, "forbidden", "file-path uploads require an agent token");
      try {
        let bytes: Buffer;
        if (fromPath) {
          const body = JSON.parse((await boundedBody(req, 8192)).toString("utf8"));
          if (typeof body?.path !== "string" || !body.path.trim()) throw new Error("path is required");
          const path = identity.scope === "agent" ? AgentManager.resolveEditorPathForAgent(identity.agentId, body.path) : null;
          if (!path) throw new Error("agent or file path is unavailable");
          bytes = readThumbnailFile(path);
        } else bytes = await boundedBody(req, THUMBNAIL_LIMIT);
        saveThumbnail(app, bytes);
      } catch (error) {
        return jsonError(400, "invalid_request", error instanceof Error ? error.message : "Invalid image");
      }
    } else if (req.method === "DELETE") deleteThumbnail(app);
    else return new Response(null, { status: 405 });
    announce(app);
    return Response.json(appToWire(app, deps.states([app.name]).get(app.name), deps.publicUrl(app)));
  }
  if (req.method !== "POST") return new Response(null, { status: 405 });
  let record = app;
  if (parts[3] === "archive" && app.archivedAt === undefined) {
    deps.teardown(app.name);
    deps.revokeToken(app.name);
    record = deps.registry.setArchived(app.name, true)!;
  } else if (parts[3] === "restore" && app.archivedAt !== undefined) {
    record = deps.registry.setArchived(app.name, false)!;
    deps.provisionToken(record);
    try {
      deps.install(record);
    } catch (error) {
      announce(record);
      return Response.json({ ...appToWire(record, undefined, deps.publicUrl(record)), startError: error instanceof Error ? error.message : "Restored but failed to start" });
    }
  }
  deps.invalidatePreview(app.name);
  announce(record);
  return Response.json(appToWire(record, deps.states([record.name]).get(record.name), deps.publicUrl(record)));
}
