import type { ServerWebSocket } from "bun";
import type { ClientCommand, ServerMessage } from "../../shared/types.ts";
import { parseRoomSkin } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import { normalizeExperimental, normalizeReceptionistAgentId } from "../persistence/config/office-config.ts";
import { getUserById, getWsUser } from "../users.ts";

export function handleSettingsCommand(cmd: ClientCommand, ws: ServerWebSocket<unknown>, canUseRoom: (roomId: string) => boolean): boolean {
  switch (cmd.type) {
    case "update_office_settings": {
      const version = typeof cmd.version === "string" ? cmd.version : "";
      if (!version) {
        ws.send(
          JSON.stringify({
            type: "settings_save_response",
            requestId: cmd.requestId,
            ok: false,
            error: "settings version is required",
          } as ServerMessage),
        );
        return true;
      }
      const currentVersion = AgentManager.officeSettingsVersion();
      if (version !== currentVersion) {
        ws.send(
          JSON.stringify({
            type: "settings_save_response",
            requestId: cmd.requestId,
            ok: false,
            error: "Office settings changed since you opened this. Reopen the dialog to edit the latest version.",
          } as ServerMessage),
        );
        return true;
      }
      const envFile = cmd.envFile && cmd.envFile.trim() ? cmd.envFile.trim() : null;
      if (envFile) {
        try {
          AgentManager.validateEnvPath(envFile);
        } catch (err: any) {
          ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: false, error: err.message || "Invalid env file" } as ServerMessage));
          return true;
        }
      }
      const current = AgentManager.getOfficeSettings();
      let experimental = current.experimental;
      if (cmd.experimental !== undefined) {
        const parsed = normalizeExperimental(cmd.experimental);
        if (!parsed) {
          ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: false, error: "experimental must be { browserPanel: boolean }" } as ServerMessage));
          return true;
        }
        experimental = parsed;
      }
      let receptionistAgentId = current.receptionistAgentId;
      if (cmd.receptionistAgentId !== undefined) {
        receptionistAgentId = normalizeReceptionistAgentId(cmd.receptionistAgentId) ?? null;
      }
      AgentManager.setOfficeSettings(cmd.prompt, envFile, experimental, receptionistAgentId);
      ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      return true;
    }
    case "update_room_settings": {
      if (!canUseRoom(cmd.roomId)) return true;
      const version = typeof cmd.version === "string" ? cmd.version : "";
      if (!version) {
        ws.send(
          JSON.stringify({
            type: "settings_save_response",
            requestId: cmd.requestId,
            ok: false,
            error: "settings version is required",
          } as ServerMessage),
        );
        return true;
      }
      const current = AgentManager.getRoomSettings(cmd.roomId);
      if (!current) {
        ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: false, error: "Room not found" } as ServerMessage));
        return true;
      }
      if (version !== AgentManager.roomSettingsVersion(current)) {
        ws.send(
          JSON.stringify({
            type: "settings_save_response",
            requestId: cmd.requestId,
            ok: false,
            error: "Room settings changed since you opened this. Reopen the dialog to edit the latest version.",
          } as ServerMessage),
        );
        return true;
      }
      const envFile = cmd.envFile && cmd.envFile.trim() ? cmd.envFile.trim() : null;
      if (envFile) {
        try {
          AgentManager.validateEnvPath(envFile);
        } catch (err: any) {
          ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: false, error: err.message || "Invalid env file" } as ServerMessage));
          return true;
        }
      }
      const ok = AgentManager.setRoomSettings(cmd.roomId, cmd.prompt, envFile);
      if (ok && "pet" in cmd) AgentManager.setRoomPet(cmd.roomId, cmd.pet ?? null);
      if (ok && "skin" in cmd) {
        const parsed = parseRoomSkin((cmd as { skin?: unknown }).skin);
        if (parsed.ok) AgentManager.setRoomSkin(cmd.roomId, parsed.skin);
      }
      if (!ok) {
        ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: false, error: "Room not found" } as ServerMessage));
      } else {
        ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      }
      return true;
    }
    case "request_cwd_validation": {
      try {
        AgentManager.validateCwd(cmd.cwd);
        ws.send(JSON.stringify({ type: "cwd_validation", requestId: cmd.requestId, ok: true } as ServerMessage));
      } catch (err: any) {
        ws.send(JSON.stringify({ type: "cwd_validation", requestId: cmd.requestId, ok: false, error: err.message || "Invalid directory" } as ServerMessage));
      }
      return true;
    }
    case "request_settings_validation": {
      let envFile: string | null = null;
      let userId: string | undefined;
      if (cmd.scope === "office") {
        envFile = AgentManager.getOfficeSettings().envFile;
      } else if (cmd.scope === "room" && cmd.roomId) {
        const room = AgentManager.getRooms().find((r) => r.id === cmd.roomId);
        envFile = room?.envFile ?? null;
      } else if (cmd.scope === "user") {
        const actor = getWsUser(ws);
        const target = cmd.userId ? getUserById(cmd.userId) : actor;
        if (!actor || !target || (actor.role !== "owner" && actor.id !== target.id)) {
          ws.send(
            JSON.stringify({
              type: "settings_validation",
              requestId: cmd.requestId,
              scope: cmd.scope,
              userId: cmd.userId,
              envFile: null,
              ok: false,
              error: "User env validation is not allowed.",
            } as ServerMessage),
          );
          return true;
        }
        userId = target.id;
        envFile = cmd.envFile !== undefined ? cmd.envFile?.trim() || null : (target.envFile ?? null);
      }
      if (!envFile) {
        ws.send(JSON.stringify({ type: "settings_validation", requestId: cmd.requestId, scope: cmd.scope, roomId: cmd.roomId, userId, envFile: null, ok: true } as ServerMessage));
        return true;
      }
      try {
        const keyCount = AgentManager.validateEnvPath(envFile);
        ws.send(JSON.stringify({ type: "settings_validation", requestId: cmd.requestId, scope: cmd.scope, roomId: cmd.roomId, userId, envFile, ok: true, keyCount } as ServerMessage));
      } catch (err: any) {
        ws.send(
          JSON.stringify({
            type: "settings_validation",
            requestId: cmd.requestId,
            scope: cmd.scope,
            roomId: cmd.roomId,
            userId,
            envFile,
            ok: false,
            error: err.message || "Invalid env file",
          } as ServerMessage),
        );
      }
      return true;
    }
    default:
      return false;
  }
}
