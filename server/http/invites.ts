import type { AuthResult } from "../auth/auth-middleware.ts";
import type { InviteWire, UserRole } from "../../shared/types.ts";

const JSON_HEADERS = { "Access-Control-Allow-Origin": "*", "Content-Type": "application/json" };
const NO_CONTENT_HEADERS = { "Access-Control-Allow-Origin": "*" };

export type InviteRevokeResult = "ok" | "not_found" | "ambiguous";
export type InviteMintResult = { ok: true; url: string; invite: InviteWire } | { ok: false; error: string; status?: number };

export interface InvitesHttpDeps {
  list(username: string, role: "owner" | "member"): InviteWire[];
  mint(input: { username: string; role: UserRole; allowExisting: boolean; createdBy: string; allowedRooms?: string[] }): Promise<InviteMintResult>;
  mintSelf(input: { username: string; role: UserRole; createdBy: string }): Promise<InviteMintResult>;
  revoke(username: string, role: "owner" | "member", tokenPrefix: string): Promise<InviteRevokeResult>;
}

export async function handleInvitesRequest(req: Request, url: URL, auth: AuthResult | undefined, deps: InvitesHttpDeps): Promise<Response | null> {
  const parts = invitesRouteParts(url.pathname);
  if (!parts) return null;
  if (auth?.kind !== "ok") return jsonError(401, "unauthenticated");

  if (req.method === "GET" && parts.length === 1) {
    return new Response(JSON.stringify({ invites: deps.list(auth.session.username, auth.session.role) }), { headers: JSON_HEADERS });
  }

  if (req.method === "POST" && parts.length === 1) {
    if (auth.session.role !== "owner") return jsonError(403, "owner access required");
    const body = await readJson(req);
    if (body instanceof Response) return body;
    const username = typeof body.username === "string" ? body.username : "";
    if (!username.trim()) return jsonError(400, "username is required");
    if (body.role !== "owner" && body.role !== "member") return jsonError(400, "role must be 'owner' or 'member'");
    if (body.allowedRooms !== undefined && (!Array.isArray(body.allowedRooms) || !body.allowedRooms.every((roomId) => typeof roomId === "string"))) {
      return jsonError(400, "allowedRooms must be an array of room ids");
    }
    return mintResponse(
      await deps.mint({
        username,
        role: body.role,
        allowExisting: !!body.allowExisting,
        createdBy: auth.session.username,
        ...(body.allowedRooms !== undefined ? { allowedRooms: body.allowedRooms } : {}),
      }),
    );
  }

  if (req.method === "POST" && parts.length === 2 && parts[1] === "self") {
    return mintResponse(await deps.mintSelf({ username: auth.session.username, role: auth.session.role, createdBy: auth.session.username }));
  }

  if (req.method === "DELETE" && parts.length === 2) {
    return revokeResponse(await deps.revoke(auth.session.username, auth.session.role, parts[1]!));
  }

  return null;
}

function mintResponse(result: InviteMintResult): Response {
  return result.ok ? new Response(JSON.stringify({ url: result.url, invite: result.invite }), { headers: JSON_HEADERS }) : jsonError(result.status ?? 409, result.error);
}

function revokeResponse(result: InviteRevokeResult): Response {
  switch (result) {
    case "ok":
      return new Response(null, { status: 204, headers: NO_CONTENT_HEADERS });
    case "ambiguous":
      return jsonError(409, "ambiguous invite prefix");
    case "not_found":
      return jsonError(404, "invite not found");
  }
}

async function readJson(req: Request): Promise<Record<string, unknown> | Response> {
  try {
    return (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonError(400, "invalid JSON");
  }
}

function invitesRouteParts(pathname: string): string[] | null {
  const parts = pathname.split("/").filter(Boolean);
  if (parts[0] !== "api" || parts[1] !== "invites") return null;
  return parts.slice(1);
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), { status, headers: JSON_HEADERS });
}
