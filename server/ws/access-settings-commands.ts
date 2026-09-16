import type { ServerWebSocket } from "bun";
import type { ClientCommand, ServerMessage } from "../../shared/types.ts";
import { normalizePublicOrigin } from "../../shared/public-origin.ts";
import { loadOfficeConfig, normalizePreviewAllowHosts, saveOfficeConfig } from "../persistence.ts";
import { getUserById, getWsUser } from "../users.ts";
import { isOutsideReachabilityBlocked, mintInvite, setOfficeName } from "../auth/auth.ts";

export async function handleAccessSettingsCommand(
  cmd: Extract<ClientCommand, { type: "get_access_settings" | "update_access_settings" }>,
  ws: ServerWebSocket<unknown>,
  pushInvitesListToEachWs: () => void,
): Promise<boolean> {
  switch (cmd.type) {
    case "get_access_settings": {
      const user = getWsUser(ws);
      if (!user || user.role !== "owner") {
        ws.send(
          JSON.stringify({
            type: "access_settings",
            ok: false,
            error: "Only owners can view access settings.",
          } as ServerMessage),
        );
        return true;
      }
      const cfg = loadOfficeConfig();
      const envRaw = process.env.BUREAU_PUBLIC_ORIGIN?.trim() ?? "";
      const envOriginSet = envRaw.length > 0;
      const envOrigin = envRaw ? normalizePublicOrigin(envRaw) : null;
      const effectiveExternal = cfg.externalAccess !== null ? cfg.externalAccess : cfg.publicOrigin !== null || envOrigin !== null;
      ws.send(
        JSON.stringify({
          type: "access_settings",
          ok: true,
          externalAccess: effectiveExternal,
          publicOrigin: cfg.publicOrigin,
          previewAllowHosts: cfg.previewAllowHosts,
          envOriginSet,
          envOrigin,
          boundLoopback: isOutsideReachabilityBlocked(),
          officeName: cfg.officeName,
        } as ServerMessage),
      );
      return true;
    }
    case "update_access_settings": {
      const user = getWsUser(ws);
      if (!user || user.role !== "owner") {
        ws.send(
          JSON.stringify({
            type: "access_settings_updated",
            requestId: cmd.requestId,
            ok: false,
            error: "Only owners can change access settings.",
          } as ServerMessage),
        );
        return true;
      }
      const wantsExternal = !!cmd.externalAccess;
      const rawOrigin = typeof cmd.publicOrigin === "string" ? cmd.publicOrigin.trim() : "";
      let publicOrigin: string | null = null;
      if (rawOrigin) {
        const normalized = normalizePublicOrigin(rawOrigin);
        if (!normalized) {
          ws.send(
            JSON.stringify({
              type: "access_settings_updated",
              requestId: cmd.requestId,
              ok: false,
              error: "Public URL must be https://<host> or http://localhost (no path, query, or fragment).",
            } as ServerMessage),
          );
          return true;
        }
        publicOrigin = normalized;
      }
      if (wantsExternal && !publicOrigin) {
        ws.send(
          JSON.stringify({
            type: "access_settings_updated",
            requestId: cmd.requestId,
            ok: false,
            error: "Enabling external access requires a public URL.",
          } as ServerMessage),
        );
        return true;
      }
      const envRaw = process.env.BUREAU_PUBLIC_ORIGIN?.trim() ?? "";
      const envOrigin = envRaw ? normalizePublicOrigin(envRaw) : null;
      if (wantsExternal && envOrigin && publicOrigin && envOrigin !== publicOrigin) {
        ws.send(
          JSON.stringify({
            type: "access_settings_updated",
            requestId: cmd.requestId,
            ok: false,
            error: `BUREAU_PUBLIC_ORIGIN is still set to ${envOrigin}. Remove it from the service environment or set the Public URL to the same value, then save again.`,
            envOrigin,
          } as ServerMessage),
        );
        return true;
      }
      const rawOfficeName = typeof cmd.officeName === "string" ? cmd.officeName.trim().slice(0, 64) : "";
      const nextOfficeName: string | null = cmd.officeName === undefined ? (loadOfficeConfig().officeName ?? null) : rawOfficeName || null;
      const prevCfg = loadOfficeConfig();
      const previewAllowHosts = Array.isArray(cmd.previewAllowHosts) ? normalizePreviewAllowHosts(cmd.previewAllowHosts) : prevCfg.previewAllowHosts;
      try {
        saveOfficeConfig({
          prompt: prevCfg.prompt,
          envFile: prevCfg.envFile,
          publicOrigin,
          externalAccess: wantsExternal,
          networkBind: prevCfg.networkBind,
          officeName: nextOfficeName,
          previewAllowHosts,
          experimental: prevCfg.experimental,
          receptionistAgentId: prevCfg.receptionistAgentId,
        });
      } catch (err) {
        ws.send(
          JSON.stringify({
            type: "access_settings_updated",
            requestId: cmd.requestId,
            ok: false,
            error: (err as Error).message,
          } as ServerMessage),
        );
        return true;
      }
      let signInUrl: string | null = null;
      if (wantsExternal && publicOrigin) {
        const me = getUserById(user.id);
        if (me) {
          const minted = await mintInvite({
            username: me.name,
            role: me.role,
            createdBy: user.name,
            allowExisting: true,
            replacePriorForUsername: true,
          });
          if (minted.ok) {
            signInUrl = `${publicOrigin}/i/${minted.rawToken}`;
            pushInvitesListToEachWs();
          } else {
            console.warn(`[auth] update_access_settings: self-invite mint failed: ${minted.error}`);
          }
        }
      }
      setOfficeName(nextOfficeName);
      ws.send(
        JSON.stringify({
          type: "access_settings_updated",
          requestId: cmd.requestId,
          ok: true,
          externalAccess: wantsExternal,
          publicOrigin,
          previewAllowHosts,
          signInUrl,
          restartRequired: true,
          envOrigin,
          officeName: nextOfficeName,
        } as ServerMessage),
      );
      return true;
    }
  }
}
