import type { ServerWebSocket } from "bun";
import { canViewRun, canViewSchedule } from "../cronjobs/access.ts";
import * as Cronjobs from "../cronjobs/index.ts";
import { getWsUser } from "../users.ts";
import { browsers } from "./broadcast.ts";

export function scheduleStateFrames(ws: ServerWebSocket<unknown>): Iterable<string> {
  const user = getWsUser(ws);
  const state = { type: "cronjobs_state", cronjobs: Cronjobs.listCronjobs().filter((job) => canViewSchedule(user, job)), cronjobsPrompt: user?.role === "owner" ? Cronjobs.getCronjobsPrompt() : null };
  const history = Cronjobs.getAllRunsByJob().map(({ jobId, runs }) => ({ jobId, runs: runs.filter((run) => canViewRun(user, run)) }));
  return (function* () {
    yield JSON.stringify(state);
    for (const { jobId, runs } of history) if (runs.length) yield JSON.stringify({ type: "cronjob_runs", cronjobId: jobId, runs });
    yield JSON.stringify({ type: "cronjob_runs_complete" });
  })();
}

export function sendScheduleState(ws: ServerWebSocket<unknown>): void {
  for (const frame of scheduleStateFrames(ws)) ws.send(frame);
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
