import type { AuthResult } from "../auth/auth-middleware.ts";
import type { UserRecord } from "../../shared/types.ts";
import { isSupportedLanguage } from "../../shared/languages.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const NO_CONTENT_HEADERS = { "Access-Control-Allow-Origin": "*" };

export type UserMutationResult = { ok: true; user: UserRecord } | { ok: false; status: number; error: string };
export type UserDeleteResult = { ok: true } | { ok: false; status: number; error: string };

export interface UsersHttpDeps {
  update(actorUserId: string, role: "owner" | "member", username: string, changes: UserRecordChanges): Promise<UserMutationResult>;
  setAccess(actorUserId: string, username: string, allowedRooms: string[]): Promise<UserMutationResult>;
  delete(actorUserId: string, role: "owner" | "member", username: string): Promise<UserDeleteResult>;
}

export type UserRecordChanges = Partial<Pick<UserRecord, "name" | "envFile" | "memberPrompt" | "language" | "avatarColor" | "avatarVariant">>;

export async function handleUsersRequest(req: Request, url: URL, auth: AuthResult | undefined, deps: UsersHttpDeps): Promise<Response | null> {
  const parts = usersRouteParts(url.pathname);
  if (!parts) return null;
  if (auth?.kind !== "ok") return jsonError(401, "authenticated browser session required");

  const username = parts[1];
  const action = parts[2];
  if (!username) return jsonError(404, "not found");

  if (req.method === "PATCH" && !action) {
    const body = await readJson(req);
    if (body instanceof Response) return body;
    const malformed = malformedUserUpdate(body);
    if (malformed) return jsonError(422, malformed);
    const result = await deps.update(auth.session.userId, auth.session.role, decodeURIComponent(username), pickUserChanges(body));
    return result.ok ? json({ user: result.user }) : jsonError(result.status, result.error);
  }

  if (req.method === "PUT" && action === "access" && parts.length === 3) {
    if (auth.session.role !== "owner") return jsonError(403, "owner access required");
    const body = await readJson(req);
    if (body instanceof Response) return body;
    if (!Array.isArray(body.allowedRooms) || !body.allowedRooms.every((roomId) => typeof roomId === "string")) {
      return jsonError(422, "allowedRooms must be an array of room ids");
    }
    const result = await deps.setAccess(auth.session.userId, decodeURIComponent(username), body.allowedRooms);
    return result.ok ? json({ user: result.user }) : jsonError(result.status, result.error);
  }

  if (req.method === "DELETE" && !action) {
    const result = await deps.delete(auth.session.userId, auth.session.role, decodeURIComponent(username));
    return result.ok ? new Response(null, { status: 204, headers: NO_CONTENT_HEADERS }) : jsonError(result.status, result.error);
  }

  return jsonError(404, "not found");
}

function malformedUserUpdate(body: Record<string, unknown>): string | null {
  if (body.name !== undefined && typeof body.name !== "string") return "name must be a string";
  if (typeof body.name === "string" && body.name.trim().length === 0) return "name cannot be empty";
  if (body.envFile !== undefined && body.envFile !== null && typeof body.envFile !== "string") return "envFile must be a string or null";
  if (body.memberPrompt !== undefined && body.memberPrompt !== null && typeof body.memberPrompt !== "string") return "memberPrompt must be a string or null";
  if (body.language !== undefined && body.language !== null && typeof body.language !== "string") return "language must be a string or null";
  if (typeof body.language === "string" && !isSupportedLanguage(body.language)) return "language must be supported or null";
  if (body.avatarColor !== undefined && typeof body.avatarColor !== "string") return "avatarColor must be a string";
  if (body.avatarVariant !== undefined && typeof body.avatarVariant !== "string") return "avatarVariant must be a string";
  return null;
}

function pickUserChanges(body: Record<string, unknown>): UserRecordChanges {
  const changes: UserRecordChanges = {};
  if (body.name !== undefined) changes.name = body.name as string;
  if (body.envFile !== undefined) changes.envFile = body.envFile as string | null;
  if (body.memberPrompt !== undefined) changes.memberPrompt = body.memberPrompt as string | null;
  if (body.language !== undefined) changes.language = body.language as UserRecord["language"];
  if (body.avatarColor !== undefined) changes.avatarColor = body.avatarColor as string;
  if (body.avatarVariant !== undefined) changes.avatarVariant = body.avatarVariant as UserRecord["avatarVariant"];
  return changes;
}

async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, "invalid JSON");
  }
}

function usersRouteParts(pathname: string): string[] | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "users") return null;
  return parts.slice(1);
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { headers: JSON_HEADERS });
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}
