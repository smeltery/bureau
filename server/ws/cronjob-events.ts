import type { ServerWebSocket } from "bun";
import { canViewRun, canViewSchedule } from "../cronjobs/access.ts";
import * as Cronjobs from "../cronjobs/index.ts";
import { getWsUser } from "../users.ts";
import { browsers } from "./broadcast.ts";

export function sendScheduleState(ws: ServerWebSocket<unknown>): void {
  const user = getWsUser(ws);
  ws.send(
    JSON.stringify({
      type: "cronjobs_state",
      cronjobs: Cronjobs.listCronjobs().filter((job) => canViewSchedule(user, job)),
      cronjobsPrompt: user?.role === "owner" ? Cronjobs.getCronjobsPrompt() : null,
    }),
  );
  for (const { jobId, runs } of Cronjobs.getAllRunsByJob()) {
    const visible = runs.filter((run) => canViewRun(user, run));
    if (visible.length) ws.send(JSON.stringify({ type: "cronjob_runs", cronjobId: jobId, runs: visible }));
  }
  ws.send(JSON.stringify({ type: "cronjob_runs_complete" }));
}

export function broadcastScheduleEvent(event: Cronjobs.CronjobEvent): void {
  if (event.type === "cronjob_added" || event.type === "cronjob_updated" || event.type === "cronjob_deleted") {
    for (const ws of browsers) sendScheduleState(ws);
    return;
  }
  if (event.type === "cronjobs_prompt_updated") {
    for (const ws of browsers) if (getWsUser(ws)?.role === "owner") ws.send(JSON.stringify(event));
    return;
  }
  const runId = event.type === "log_entry" ? event.entry.agentId.replace(/^cronrun-/, "") : event.type === "clear_logs" ? event.agentId.replace(/^cronrun-/, "") : event.run.id;
  const run =
    event.type === "cronjob_run_updated"
      ? event.run
      : Cronjobs.getAllRunsByJob()
          .flatMap((job) => job.runs)
          .find((row) => row.id === runId);
  if (!run) return;
  for (const ws of browsers) if (canViewRun(getWsUser(ws), run)) ws.send(JSON.stringify(event));
}
