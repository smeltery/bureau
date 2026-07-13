import type { UserRecord } from "../../shared/types.ts";
import { normalizePublicOrigin } from "../../shared/public-origin.ts";
import * as AgentManager from "../agent-manager.ts";
import { browsers } from "../ws/broadcast.ts";
import { pushPresenceListToEachWs, sendInitialPayload } from "../ws-initial-payload.ts";
import { refreshPresenceForUser } from "../presence.ts";
import { loadOfficeConfig, saveOfficeConfig } from "../persistence.ts";
import { evictSessionsForUserId, isProcessBoundLoopback, mintInvite, setOfficeName } from "../auth/auth.ts";
import { deleteUserById, getUserById, getUserByName, updateUser, wouldDeleteLeaveNoOwner } from "../users.ts";
import { pushInvitesListToEachWs } from "../access-broadcasts.ts";
import type { AccessSettingsWire, SetAccessResult } from "./access.ts";
import type { UserDeleteResult, UserMutationResult, UserRecordChanges } from "./users.ts";
import type { ViewChangeInput } from "./view.ts";

export function readAccessSettingsForApi(): AccessSettingsWire {
  const cfg = loadOfficeConfig();
  const envRaw = process.env.BUREAU_PUBLIC_ORIGIN?.trim() ?? "";
  const envOrigin = envRaw ? normalizePublicOrigin(envRaw) : null;
  const effectiveExternal = cfg.externalAccess !== null ? cfg.externalAccess : cfg.publicOrigin !== null || envOrigin !== null;
  return {
    externalAccess: effectiveExternal,
    publicOrigin: cfg.publicOrigin,
    envOriginSet: envRaw.length > 0,
    envOrigin,
    boundLoopback: isProcessBoundLoopback(),
    officeName: cfg.officeName,
  };
}

export async function saveAccessSettingsForApi(actorUserId: string, input: { externalAccess: boolean; publicOrigin: string }): Promise<SetAccessResult> {
  const rawOrigin = input.publicOrigin.trim();
  const publicOrigin = rawOrigin ? normalizePublicOrigin(rawOrigin) : null;
  if (rawOrigin && !publicOrigin) {
    return { ok: false, status: 400, error: "Public URL must be https://<host> or http://localhost (no path, query, or fragment)." };
  }
  if (input.externalAccess && !publicOrigin) {
    return { ok: false, status: 400, error: "Enabling external access requires a public URL." };
  }

  const envRaw = process.env.BUREAU_PUBLIC_ORIGIN?.trim() ?? "";
  const envOrigin = envRaw ? normalizePublicOrigin(envRaw) : null;
  if (input.externalAccess && envOrigin && publicOrigin && envOrigin !== publicOrigin) {
    return {
      ok: false,
      status: 409,
      error: `BUREAU_PUBLIC_ORIGIN is still set to ${envOrigin}. Remove it from the service environment or set the Public URL to the same value, then save again.`,
      envOrigin,
    };
  }

  const prevCfg = loadOfficeConfig();
  try {
    saveOfficeConfig({
      prompt: prevCfg.prompt,
      envFile: prevCfg.envFile,
      publicOrigin,
      externalAccess: input.externalAccess,
      officeName: prevCfg.officeName,
    });
  } catch (err) {
    return { ok: false, status: 500, error: err instanceof Error ? err.message : "failed to save access settings" };
  }

  let signInUrl: string | null = null;
  if (input.externalAccess && publicOrigin) {
    const actor = getUserById(actorUserId);
    if (actor) {
      const minted = await mintInvite({
        username: actor.name,
        role: actor.role,
        createdBy: actor.name,
        allowExisting: true,
        replacePriorForUsername: true,
      });
      if (minted.ok) {
        signInUrl = `${publicOrigin}/i/${minted.rawToken}`;
        pushInvitesListToEachWs();
      } else {
        console.warn(`[auth] access settings self-invite mint failed: ${minted.error}`);
      }
    }
  }

  setOfficeName(prevCfg.officeName);
  return { ok: true, signInUrl, restartRequired: true };
}

export function applyViewPreference(userId: string, change: ViewChangeInput): boolean {
  const actor = getUserById(userId);
  const updated = updateUser(actor, userId, change, AgentManager.getRooms());
  if (!updated) return false;
  pushUserViewUpdate(updated);
  return true;
}

export async function updateUserForApi(actorUserId: string, actorRole: "owner" | "member", username: string, changes: UserRecordChanges): Promise<UserMutationResult> {
  const actor = getUserById(actorUserId);
  const target = getUserByName(username);
  if (!actor || !target) return { ok: false, status: 404, error: "user not found" };
  if (actorRole !== "owner" && actor.id !== target.id) return { ok: false, status: 403, error: "forbidden" };
  if (typeof changes.envFile === "string" && changes.envFile.trim()) {
    try {
      AgentManager.validateEnvPath(changes.envFile.trim());
    } catch (err) {
      return { ok: false, status: 422, error: err instanceof Error ? err.message : "invalid env file" };
    }
  }
  const updated = updateUser(actor, target.id, changes, AgentManager.getRooms());
  if (!updated) return { ok: false, status: 404, error: "user not found" };
  pushUserViewUpdate(updated);
  return { ok: true, user: updated };
}

export async function setUserAccessForApi(actorUserId: string, username: string, allowedRooms: string[]): Promise<UserMutationResult> {
  const actor = getUserById(actorUserId);
  const target = getUserByName(username);
  if (!actor || actor.role !== "owner") return { ok: false, status: 403, error: "owner access required" };
  if (!target) return { ok: false, status: 404, error: "user not found" };
  const updated = updateUser(actor, target.id, { allowedRooms }, AgentManager.getRooms());
  if (!updated) return { ok: false, status: 404, error: "user not found" };
  pushUserViewUpdate(updated);
  return { ok: true, user: updated };
}

export async function deleteUserForApi(actorUserId: string, actorRole: "owner" | "member", username: string): Promise<UserDeleteResult> {
  const target = getUserByName(username);
  if (!target) return { ok: false, status: 404, error: "user not found" };
  if (actorRole !== "owner" && actorUserId !== target.id) return { ok: false, status: 403, error: "forbidden" };
  if (actorRole === "owner" && actorUserId === target.id) return { ok: false, status: 409, error: "owners cannot delete their own user record" };
  if (wouldDeleteLeaveNoOwner(target.id)) return { ok: false, status: 409, error: "would leave office without an owner" };
  if (!deleteUserById(target.id)) return { ok: false, status: 404, error: "user not found" };
  for (const browser of browsers) sendInitialPayload(browser);
  await evictSessionsForUserId(target.id);
  return { ok: true };
}

function pushUserViewUpdate(user: Pick<UserRecord, "id" | "name" | "avatarColor" | "avatarVariant" | "allowedRooms">) {
  for (const browser of browsers) sendInitialPayload(browser);
  refreshPresenceForUser(user.id, { name: user.name, avatarColor: user.avatarColor, avatarVariant: user.avatarVariant }, new Set(user.allowedRooms));
  pushPresenceListToEachWs();
}
