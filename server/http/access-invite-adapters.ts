import type { InviteWire, ServerMessage } from "../../shared/types.ts";
import { buildPublicOrigin, INVITE_TTL_MS, mintInvite, revokeInviteByPrefix, revokeOutstandingInviteByPrefixForUsername } from "../auth/auth.ts";
import { broadcastToOwners, pushInvitesListToEachWs } from "../access-broadcasts.ts";
import { getUserById } from "../users.ts";
import type { InviteMintResult, InviteRevokeResult } from "./invites.ts";

export async function mintInviteForApi(input: { username: string; role: "owner" | "member"; allowExisting: boolean; createdBy: string; allowedRooms?: string[] }): Promise<InviteMintResult> {
  const result = await mintInvite(input);
  if (!result.ok) return { ok: false, error: result.error, ...(result.code === "INVALID_ALLOWED_ROOMS" ? { status: 400 } : {}) };
  const { origin } = buildPublicOrigin();
  pushInvitesListToEachWs();
  return { ok: true, url: `${origin}/i/${result.rawToken}`, invite: wireInvite(result.invite) };
}

export async function mintSelfInviteForApi(input: { username: string; role: "owner" | "member"; createdBy: string }): Promise<InviteMintResult> {
  const result = await mintInvite({
    ...input,
    allowExisting: true,
    replacePriorForUsername: true,
  });
  if (!result.ok) return { ok: false, error: result.error };
  const { origin } = buildPublicOrigin();
  pushInvitesListToEachWs();
  return { ok: true, url: `${origin}/i/${result.rawToken}`, invite: wireInvite(result.invite) };
}

export async function mintRecoveryInviteForApi(input: { actorName: string; userId: string }): Promise<InviteMintResult> {
  const user = getUserById(input.userId);
  if (!user) return { ok: false, error: "user not found", status: 404 };
  const result = await mintInvite({
    username: user.name,
    role: user.role,
    createdBy: input.actorName,
    allowExisting: true,
    replacePriorForUsername: true,
    ttlMsOverride: INVITE_TTL_MS,
  });
  if (!result.ok) return { ok: false, error: result.error };
  const { origin } = buildPublicOrigin();
  pushInvitesListToEachWs();
  return { ok: true, url: `${origin}/i/${result.rawToken}`, invite: wireInvite(result.invite) };
}

export async function revokeInviteForApi(username: string, role: "owner" | "member", tokenPrefix: string): Promise<InviteRevokeResult> {
  const result = role === "owner" ? await revokeInviteByPrefix(tokenPrefix) : await revokeOutstandingInviteByPrefixForUsername(tokenPrefix, username);
  if (result === "ok") {
    broadcastToOwners({ type: "invite_revoked", tokenPrefix } as ServerMessage);
    pushInvitesListToEachWs();
  }
  return result;
}

function wireInvite(invite: {
  tokenPrefix: string;
  username: string | null;
  role: "owner" | "member";
  createdBy: string | null;
  createdAt: number;
  expiresAt: number;
  allowedRooms?: string[];
  bootstrap: boolean;
}): InviteWire {
  return {
    tokenPrefix: invite.tokenPrefix,
    username: invite.username,
    role: invite.role,
    createdBy: invite.createdBy,
    createdAt: invite.createdAt,
    expiresAt: invite.expiresAt,
    ...(invite.allowedRooms ? { allowedRooms: invite.allowedRooms } : {}),
    ...(invite.bootstrap ? { bootstrap: true as const } : {}),
  };
}
