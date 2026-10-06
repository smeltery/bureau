import type { Cronjob, CronjobRun } from "../../shared/types.ts";
import type { CronjobEvent } from "./index.ts";
import { clampSchedule, computeNextFire } from "./schedule.ts";

export interface CronjobSchedulerDeps {
  getCronjobs(): Cronjob[];
  setCronjobs(cronjobs: Cronjob[]): void;
  loadCronjobs(): Cronjob[];
  saveCronjobs(cronjobs: Cronjob[]): void;
  loadCronjobsPrompt(): string | null;
  setCronjobsPrompt(prompt: string | null): void;
  listAllCronjobIdsOnDisk(): string[];
  loadRuns(jobId: string): CronjobRun[];
  saveRuns(jobId: string, runs: CronjobRun[]): void;
  getUserByName(username: string): { id: string } | null | undefined;
  hasInFlightScheduledRun(jobId: string): boolean;
  recordSkippedRun(job: Cronjob): CronjobRun;
  fire(job: Cronjob, trigger: CronjobRun["trigger"], triggeredBy?: string): CronjobRun | null;
  emitEvent(event: CronjobEvent): void;
  tickIntervalMs: number;
}

export function tickCronjobScheduler(deps: CronjobSchedulerDeps, now: number = Date.now()) {
  const cronjobs = deps.getCronjobs();
  for (const job of cronjobs) {
    if (!job.enabled || job.schedule.type === "manual" || job.nextFireAt === null) continue;
    if (now < job.nextFireAt) continue;
    if (deps.hasInFlightScheduledRun(job.id)) {
      deps.recordSkippedRun(job);
      job.nextFireAt = computeNextFire(job.schedule, job.lastFireAt ?? job.createdAt, now);
      deps.saveCronjobs(cronjobs);
      deps.emitEvent({ type: "cronjob_updated", cronjob: job });
      continue;
    }
    job.lastFireAt = now;
    job.nextFireAt = computeNextFire(job.schedule, job.lastFireAt, now);
    deps.saveCronjobs(cronjobs);
    deps.emitEvent({ type: "cronjob_updated", cronjob: job });
    deps.fire(job, "scheduled");
  }
}

export function startCronjobSchedulerWithDeps(deps: CronjobSchedulerDeps) {
  // Load configs and cronjobsPrompt.
  const cronjobs = deps.loadCronjobs();
  deps.setCronjobs(cronjobs);
  deps.setCronjobsPrompt(deps.loadCronjobsPrompt());

  // Recompute nextFireAt for every cronjob from current time forward.
  const now = Date.now();
  let dirty = false;
  for (const job of cronjobs) {
    if (!job.userId && job.username) {
      const owner = deps.getUserByName(job.username);
      if (owner) {
        job.userId = owner.id;
        dirty = true;
      }
    }
    const schedule = clampSchedule(job.schedule);
    const anchor = job.lastFireAt ?? job.createdAt;
    const next = computeNextFire(schedule, anchor, now);
    if (next !== job.nextFireAt) {
      job.nextFireAt = next;
      dirty = true;
    }
  }
  if (dirty) deps.saveCronjobs(cronjobs);

  // Mark any "running" rows on disk as failed — server crashed mid-run.
  for (const jobId of deps.listAllCronjobIdsOnDisk()) {
    const runs = deps.loadRuns(jobId);
    let mutated = false;
    for (const run of runs) {
      if (run.status === "running") {
        run.status = "failed";
        run.endedAt = now;
        run.errorReason = "server restarted during run";
        mutated = true;
      }
    }
    if (mutated) deps.saveRuns(jobId, runs);
  }

  setTimeout(() => tickCronjobScheduler(deps), 5_000); // initial tick after small delay
  setInterval(() => tickCronjobScheduler(deps), deps.tickIntervalMs);
}
