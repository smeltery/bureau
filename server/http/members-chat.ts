// Humans-only team chat REST surface. Cookie session required — API tokens,
// loopback agent callers, and agent bearer tokens are refused. Owners may
// pin or delete any message; authors may delete their own.

import type { AuthResult } from "../auth/auth-middleware.ts";
import { getUserById } from "../users.ts";
import { broadcast } from "../ws/broadcast.ts";
import type { MembersChatMessage } from "../../shared/members-chat.ts";
import { MembersChatError, membersChatStore } from "../members-chat/index.ts";
import type { MembersChatStore } from "../members-chat/store.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const MAX_DEVICE_CHARS = 64;
const ROOT = "/api/members-chat";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

function error(status: number, code: string, message?: string): Response {
  return json({ error: message ?? code, code }, status);
}

function requireBrowserSession(auth: AuthResult | undefined): Extract<AuthResult, { kind: "ok" }> | Response {
  if (!auth || auth.kind !== "ok") {
    return error(401, "browser_session_required", "authenticated browser session required");
  }
  return auth;
}

function storeError(err: unknown): Response {
  if (err instanceof MembersChatError) {
    if (err.code === "reply_not_found") return error(404, err.code, err.message);
    return error(400, err.code, err.message);
  }
  throw err;
}

function emitMessage(message: MembersChatMessage, updateOnly = false): void {
  broadcast({ type: "members_chat_message", message, ...(updateOnly ? { updateOnly: true } : {}) });
}

function emitDeleted(id: string): void {
  broadcast({ type: "members_chat_deleted", id });
}

function parseIdPath(pathname: string): { id: string; action: "message" | "pin" } | null {
  if (!pathname.startsWith(ROOT + "/")) return null;
  const rest = pathname.slice(ROOT.length + 1);
  const parts = rest.split("/").filter(Boolean);
  if (parts.length === 1) return { id: decodeURIComponent(parts[0]), action: "message" };
  if (parts.length === 2 && parts[1] === "pin") return { id: decodeURIComponent(parts[0]), action: "pin" };
  return null;
}

export async function handleMembersChatRequest(req: Request, url: URL, auth: AuthResult | undefined, store: MembersChatStore = membersChatStore): Promise<Response | null> {
  if (url.pathname !== ROOT && !url.pathname.startsWith(ROOT + "/")) return null;

  const session = requireBrowserSession(auth);
  if (session instanceof Response) return session;

  const user = getUserById(session.session.userId);
  const userName = user?.name ?? session.session.username;
  const isOwner = session.session.role === "owner";

  if (url.pathname === ROOT && req.method === "GET") {
    const before = url.searchParams.get("before") ?? undefined;
    const rawLimit = url.searchParams.get("limit");
    const limit = rawLimit ? Number.parseInt(rawLimit, 10) : undefined;
    const page = store.page({
      before,
      limit: Number.isFinite(limit) ? limit : undefined,
    });
    return json(page);
  }

  if (url.pathname === ROOT && req.method === "POST") {
    let body: unknown;
    try {
      body = await req.json();
    } catch {
      return error(400, "invalid_json", "invalid JSON");
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return error(400, "invalid_request", "body must be an object");
    }
    const record = body as Record<string, unknown>;
    if (typeof record.text !== "string") {
      return error(400, "invalid_request", "text must be a string");
    }
    if (record.replyTo !== undefined && typeof record.replyTo !== "string") {
      return error(400, "invalid_request", "replyTo must be a message id");
    }
    let device: string | undefined;
    if (typeof record.device === "string") {
      const trimmed = record.device.trim().slice(0, MAX_DEVICE_CHARS);
      if (trimmed) device = trimmed;
    }
    let message: MembersChatMessage;
    try {
      message = store.post({
        userId: session.session.userId,
        userName,
        content: record.text,
        ...(device ? { device } : {}),
        ...(typeof record.replyTo === "string" ? { replyTo: record.replyTo } : {}),
      });
    } catch (err) {
      return storeError(err);
    }
    emitMessage(message);
    return json(message, 201);
  }

  const parsed = parseIdPath(url.pathname);
  if (!parsed) return error(404, "not_found");

  if (parsed.action === "pin" && (req.method === "PUT" || req.method === "POST")) {
    if (!isOwner) return error(403, "owner_required", "owner access required");
    let body: unknown = {};
    try {
      if (req.headers.get("content-type")?.includes("application/json")) {
        body = await req.json();
      }
    } catch {
      return error(400, "invalid_json", "invalid JSON");
    }
    const active = body && typeof body === "object" && !Array.isArray(body) && "active" in body ? Boolean((body as { active: unknown }).active) : true;
    const message = store.setPinned(parsed.id, active);
    if (!message) return error(404, "not_found");
    emitMessage(message, true);
    return json(message);
  }

  if (parsed.action === "message" && req.method === "DELETE") {
    const existing = store.get(parsed.id);
    if (!existing) return error(404, "not_found");
    if (!isOwner && existing.userId !== session.session.userId) {
      return error(403, "forbidden", "can only delete your own messages");
    }
    store.delete(parsed.id);
    emitDeleted(parsed.id);
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
  }

  return error(405, "method_not_allowed");
}
