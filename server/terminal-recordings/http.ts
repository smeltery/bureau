import type { AuthResult } from "../auth/auth-middleware.ts";
import { getUserById } from "../users.ts";
import { deleteRecording, listRecordingIds, readRecording, readRecordingHeader } from "./files.ts";
import { isRecordingActive, recordingEnabled, saveRecordingEnabled } from "./store.ts";

export async function handleRecordingRequest(req: Request, url: URL, auth: AuthResult): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/terminal-recordings")) return null;
  if (auth.kind !== "ok" || req.headers.has("authorization")) return Response.json({ error: "browser session required" }, { status: 401 });
  const owner = () => getUserById(auth.session.userId)?.role === "owner";
  if (!owner()) return Response.json({ error: "owner access required" }, { status: 403 });
  const json = (value: unknown) => Response.json(value, { headers: { "Cache-Control": "no-store" } });
  try {
    if (url.pathname === "/api/terminal-recordings/settings") {
      if (req.method === "GET") return json({ enabled: recordingEnabled() });
      if (req.method !== "PATCH") return new Response(null, { status: 405 });
      const reader = req.body?.getReader();
      let text = "";
      if (reader)
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          if (text.length + value.length > 1024) {
            await reader.cancel();
            return Response.json({ error: "body too large" }, { status: 413 });
          }
          text += new TextDecoder().decode(value);
        }
      let body: unknown;
      try {
        body = JSON.parse(text);
      } catch {
        return Response.json({ error: "invalid JSON" }, { status: 400 });
      }
      if (!body || typeof body !== "object" || Object.keys(body).length !== 1 || !("enabled" in body) || typeof body.enabled !== "boolean")
        return Response.json({ error: "enabled must be a boolean" }, { status: 400 });
      if (!owner()) return Response.json({ error: "owner access required" }, { status: 403 });
      saveRecordingEnabled(body.enabled);
      return json({ enabled: body.enabled });
    }
    if (url.pathname === "/api/terminal-recordings" && req.method === "GET") {
      const ids = listRecordingIds();
      const recordings = ids
        .map((id) => {
          const header = readRecordingHeader(id);
          return { ...header, active: isRecordingActive(id) };
        })
        .sort((a, b) => b.startedAt - a.startedAt);
      return json({ recordings });
    }
    const match = url.pathname.match(/^\/api\/terminal-recordings\/([a-f0-9-]{36})$/);
    if (!match) return new Response(null, { status: 404 });
    const id = match[1]!;
    if (req.method === "GET") return json(readRecording(id, isRecordingActive(id)));
    if (req.method === "DELETE") {
      if (isRecordingActive(id)) return Response.json({ error: "Close the terminal before removing its recording" }, { status: 409 });
      deleteRecording(id);
      return json({ deleted: true });
    }
    return new Response(null, { status: 405 });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return Response.json({ error: "Recording not found" }, { status: 404 });
    console.error("[terminal] recording request failed", error);
    return Response.json({ error: "Unable to read or save terminal recordings" }, { status: 500 });
  }
}
