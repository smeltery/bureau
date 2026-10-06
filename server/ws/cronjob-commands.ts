import type { ServerWebSocket } from "bun";
import type { ClientCommand, ServerMessage } from "../../shared/types.ts";
import { canViewRun, canManageSchedule } from "../cronjobs/access.ts";
import { scheduleRoomAllowed } from "../http/cronjob-route-helpers.ts";
import { InvalidModelFamilyError } from "../agent-validators.ts";
import * as AgentManager from "../agent-manager.ts";
import * as CronjobManager from "../cronjobs/index.ts";
import { parseCronjobChanges, parseCronjobCreate } from "../http/cronjob-route-helpers.ts";
import { saveRecentCwd } from "../persistence.ts";
import { getWsUser } from "../users.ts";

export function handleCronjobCommand(cmd: ClientCommand, ws: ServerWebSocket<unknown>): boolean {
  const user = getWsUser(ws);
  const deny = () => {
    if ("requestId" in cmd && cmd.requestId) ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: "schedule access required" }));
    return true;
  };
  if (["update_cronjob", "delete_cronjob", "run_cronjob_now"].includes(cmd.type) && "id" in cmd) {
    const job = CronjobManager.listCronjobs().find((j) => j.id === cmd.id);
    if (!job || !canManageSchedule(user, job)) return deny();
  }
  if (["load_cronjob_run", "send_cronjob_run_message", "edit_cronjob_run_message"].includes(cmd.type) && "cronjobId" in cmd && "runId" in cmd) {
    const run = CronjobManager.getRunsForCronjob(cmd.cronjobId).find((r) => r.id === cmd.runId);
    if (!run || !canViewRun(user, run)) return deny();
    if (cmd.type !== "load_cronjob_run" && !canManageSchedule(user, { roomId: run.roomIdSnapshot, userId: run.userIdSnapshot ?? null })) return deny();
  }
  switch (cmd.type) {
    case "add_cronjob": {
      if (!user || (cmd.roomId && !scheduleRoomAllowed(user, cmd.roomId))) return deny();
      const parsed = parseCronjobCreate({ ...cmd });
      if (!parsed.ok) {
        if (cmd.requestId) {
          ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: parsed.error } as ServerMessage));
        }
        return true;
      }
      try {
        AgentManager.validateCwd(parsed.draft.cwd);
      } catch (err: any) {
        if (cmd.requestId) {
          ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: err.message || "Invalid directory" } as ServerMessage));
        }
        return true;
      }
      saveRecentCwd(parsed.draft.cwd);
      try {
        CronjobManager.addCronjob({
          ...parsed.draft,
          username: user.name,
          userId: getWsUser(ws)?.id ?? null,
          device: cmd.device,
        });
      } catch (err) {
        if (err instanceof InvalidModelFamilyError) {
          if (cmd.requestId) {
            ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: err.message } as ServerMessage));
          }
          return true;
        }
        throw err;
      }
      if (cmd.requestId) {
        ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      }
      return true;
    }
    case "update_cronjob": {
      if (cmd.changes.roomId !== undefined && (!cmd.changes.roomId || !scheduleRoomAllowed(user, cmd.changes.roomId))) return deny();
      if (cmd.changes.cwd) {
        try {
          AgentManager.validateCwd(cmd.changes.cwd);
        } catch (err: any) {
          if (cmd.requestId) {
            ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: err.message || "Invalid directory" } as ServerMessage));
          }
          return true;
        }
        saveRecentCwd(cmd.changes.cwd);
      }
      const parsed = parseCronjobChanges(cmd.changes);
      if (!parsed.ok) {
        if (cmd.requestId) {
          ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: parsed.error } as ServerMessage));
        }
        return true;
      }
      try {
        CronjobManager.updateCronjob(cmd.id, parsed.changes);
      } catch (err) {
        if (err instanceof InvalidModelFamilyError) {
          if (cmd.requestId) {
            ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: false, error: err.message } as ServerMessage));
          }
          return true;
        }
        throw err;
      }
      if (cmd.requestId) {
        ws.send(JSON.stringify({ type: "agent_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      }
      return true;
    }
    case "delete_cronjob":
      CronjobManager.deleteCronjob(cmd.id);
      return true;
    case "run_cronjob_now":
      CronjobManager.runCronjobNow(cmd.id, user!.name, cmd.device);
      return true;
    case "update_cronjobs_prompt":
      if (user?.role !== "owner") return deny();
      CronjobManager.setCronjobsPrompt(cmd.value);
      ws.send(JSON.stringify({ type: "settings_save_response", requestId: cmd.requestId, ok: true } as ServerMessage));
      return true;
    case "list_cronjob_runs": {
      const runs = CronjobManager.getRunsForCronjob(cmd.cronjobId).filter((run) => canViewRun(user, run));
      ws.send(JSON.stringify({ type: "cronjob_runs", cronjobId: cmd.cronjobId, runs } as ServerMessage));
      return true;
    }
    case "list_all_cronjob_runs": {
      // Returns runs for every cronjob dir on disk (including deleted ones)
      // so the Runs tab can surface historical runs after a cronjob is gone.
      for (const { jobId, runs } of CronjobManager.getAllRunsByJob()) {
        ws.send(JSON.stringify({ type: "cronjob_runs", cronjobId: jobId, runs: runs.filter((run) => canViewRun(user, run)) } as ServerMessage));
      }
      // Sentinel so the client can flip its "runs loaded" flag even when no
      // cronjob has ever fired (no run dirs on disk = zero cronjob_runs sent).
      ws.send(JSON.stringify({ type: "cronjob_runs_complete" } as ServerMessage));
      return true;
    }
    case "load_cronjob_run": {
      // Client passes jobId from the run row it just clicked, so no scan
      // needed. Works for runs from deleted cronjobs too: getRunTranscript
      // reads from disk regardless of whether the cronjob config still exists.
      const { entries } = CronjobManager.getRunTranscript(cmd.cronjobId, cmd.runId);
      for (const entry of entries) {
        ws.send(JSON.stringify({ type: "log_entry", entry } as ServerMessage));
      }
      return true;
    }
    case "send_cronjob_run_message":
      // Don't await — let it stream in the background (matches send_message).
      CronjobManager.sendRunMessage(cmd.cronjobId, cmd.runId, cmd.text, user!.name);
      return true;
    case "edit_cronjob_run_message":
      // Don't await — let it stream in the background (matches edit_message).
      CronjobManager.editRunMessage(cmd.cronjobId, cmd.runId, cmd.logEntryId, cmd.newText, user!.name);
      return true;
    default:
      return false;
  }
}
