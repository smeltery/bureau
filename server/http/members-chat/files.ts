import type { MembersChatStore } from "../../members-chat/store.ts";
import { CHAT_MAX_FILES, CHAT_MAX_TOTAL_BYTES } from "../../members-chat/attachments.ts";
import { MAX_FILE_BYTES } from "../../persistence/files.ts";
import { untrustedFileHeaders } from "../../auth/auth-pages.ts";
import { recordAuditEvent } from "../../audit/store.ts";

// Called only after the team chat's browser-session check.
export async function handleChatFiles(req: Request, url: URL, store: MembersChatStore): Promise<Response | null> {
  const root = "/api/members-chat";
  if (url.pathname === root + "/uploads" && req.method === "POST") {
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return Response.json({ error: "Expected multipart form data" }, { status: 400 });
    }
    const files: File[] = [];
    for (const [, value] of form) if (value instanceof File) files.push(value);
    if (!files.length || files.length > CHAT_MAX_FILES || files.some((file) => file.size > MAX_FILE_BYTES) || files.reduce((total, file) => total + file.size, 0) > CHAT_MAX_TOTAL_BYTES) {
      return Response.json({ error: "Upload exceeds file count or size limits" }, { status: 400 });
    }
    try {
      const attachments = [];
      for (const file of files) attachments.push(store.saveAttachment(Buffer.from(await file.arrayBuffer()), file.type, file.name));
      recordAuditEvent("members-chat/uploads", ["uploaded"]);
      return Response.json({ attachments });
    } catch (error) {
      console.error("[team-chat] Upload failed:", error);
      return Response.json({ error: "Upload failed" }, { status: 500 });
    }
  }
  if (url.pathname.startsWith(root + "/files/") && req.method === "GET") {
    let filename: string;
    try {
      filename = decodeURIComponent(url.pathname.slice((root + "/files/").length));
    } catch {
      return new Response("Not found", { status: 404 });
    }
    const attachment = store.getAttachment(filename);
    const path = store.attachmentPath(filename);
    if (!attachment || !path) return new Response("Not found", { status: 404 });
    return new Response(Bun.file(path), {
      headers: { ...untrustedFileHeaders(attachment.mediaType), "Content-Disposition": "inline; filename*=UTF-8''" + encodeURIComponent(attachment.originalName) },
    });
  }
  return null;
}
