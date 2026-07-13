import type { ClientCommand, Cronjob } from "../shared/types.ts";
import { generateCronjobId } from "../shared/types.ts";
import { shimEmit } from "../ui/ws.ts";
import { computeNextFireDemo, cronjobs, setCronjobsPrompt } from "./demo-cronjobs.ts";

type DemoCronjobCommand = Extract<
  ClientCommand,
  | { type: "add_cronjob" }
  | { type: "update_cronjob" }
  | { type: "delete_cronjob" }
  | { type: "update_cronjobs_prompt" }
  | { type: "list_all_cronjob_runs" }
>;

export function handleDemoCronjobCommand(cmd: DemoCronjobCommand): void {
  switch (cmd.type) {
    case "add_cronjob": {
      const now = Date.now();
      const id = generateCronjobId(cronjobs.map((c) => c.id));
      const cronjob: Cronjob = {
        id,
        name: cmd.name,
        schedule: cmd.schedule,
        prompt: cmd.prompt,
        cwd: cmd.cwd,
        modelFamily: cmd.modelFamily,
        permissionMode: cmd.permissionMode,
        enabled: true,
        createdBy: cmd.username,
        device: cmd.device ?? null,
        createdAt: now,
        lastFireAt: null,
        nextFireAt: computeNextFireDemo(cmd.schedule, now, now),
      };
      cronjobs.push(cronjob);
      shimEmit({ type: "cronjob_added", cronjob });
      if (cmd.requestId) {
        shimEmit({ type: "agent_save_response", requestId: cmd.requestId, ok: true });
      }
      break;
    }
    case "update_cronjob": {
      const idx = cronjobs.findIndex((c) => c.id === cmd.id);
      if (idx >= 0) {
        const merged: Cronjob = { ...cronjobs[idx], ...cmd.changes };
        if (cmd.changes.schedule) {
          const anchor = merged.lastFireAt ?? merged.createdAt;
          merged.nextFireAt = computeNextFireDemo(cmd.changes.schedule, anchor, Date.now());
        }
        cronjobs[idx] = merged;
        shimEmit({ type: "cronjob_updated", cronjob: merged });
      }
      if (cmd.requestId) {
        shimEmit({ type: "agent_save_response", requestId: cmd.requestId, ok: true });
      }
      break;
    }
    case "delete_cronjob": {
      const idx = cronjobs.findIndex((c) => c.id === cmd.id);
      if (idx >= 0) {
        cronjobs.splice(idx, 1);
        shimEmit({ type: "cronjob_deleted", id: cmd.id });
      }
      break;
    }
    case "update_cronjobs_prompt": {
      const value = setCronjobsPrompt(cmd.value);
      shimEmit({ type: "cronjobs_prompt_updated", value });
      shimEmit({ type: "settings_save_response", requestId: cmd.requestId, ok: true });
      break;
    }
    case "list_all_cronjob_runs": {
      // Demo cron jobs never actually fire, so there are no runs to send.
      // Still emit the sentinel so the client flips its "runs loaded" flag.
      shimEmit({ type: "cronjob_runs_complete" });
      break;
    }
  }
}
