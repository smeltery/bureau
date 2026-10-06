import { afterEach, expect, mock, test } from "bun:test";
import { rmSync } from "node:fs";
import { join } from "node:path";
import { humanizeSchedule, type Cronjob } from "../../../shared/types.ts";
import { parseCronjobChanges, parseCronjobCreate } from "../../http/cronjob-route-helpers.ts";
import { loadCronjobs } from "../../persistence/cronjobs.ts";
import { CRONJOBS_DIR } from "../../persistence/paths.ts";
import * as CronjobManager from "../index.ts";
import { clampSchedule, computeNextFire } from "../schedule.ts";
import { tickCronjobScheduler, type CronjobSchedulerDeps } from "../scheduler.ts";

const createdIds: string[] = [];
afterEach(() => {
  for (const id of createdIds.splice(0)) {
    CronjobManager.deleteCronjob(id);
    rmSync(join(CRONJOBS_DIR, id), { recursive: true, force: true });
  }
});

function createJob(): Cronjob {
  const parsed = parseCronjobCreate({
    name: "Release check",
    schedule: { type: "manual" },
    prompt: "Check the release",
    cwd: process.cwd(),
    agentType: "claude",
    modelFamily: "opus",
    effort: "high",
    permissionMode: "bypassPermissions",
  });
  if (!parsed.ok) throw new Error(parsed.error);
  const job = CronjobManager.addCronjob({ ...parsed.draft, username: "Owner" });
  createdIds.push(job.id);
  return job;
}

test("on-demand definitions round-trip without a timer and can change cadence", () => {
  const job = createJob();
  expect(job.nextFireAt).toBeNull();
  expect(loadCronjobs().find((saved) => saved.id === job.id)).toMatchObject({ schedule: { type: "manual" }, nextFireAt: null });
  expect(humanizeSchedule(job.schedule)).toBe("On demand");
  expect(clampSchedule(job.schedule)).toEqual({ type: "manual" });
  expect(computeNextFire(job.schedule, 0, Date.now())).toBeNull();

  const recurring = CronjobManager.updateCronjob(job.id, { schedule: { type: "interval", minutes: 10 } });
  expect(recurring!.nextFireAt).toBeGreaterThan(Date.now());
  const parsed = parseCronjobChanges({ schedule: { type: "manual" } });
  if (!parsed.ok) throw new Error(parsed.error);
  expect(CronjobManager.updateCronjob(job.id, parsed.changes)?.nextFireAt).toBeNull();
  expect(loadCronjobs().find((saved) => saved.id === job.id)?.nextFireAt).toBeNull();
});

test("scheduler ignores on-demand jobs even with a stale next-fire timestamp", () => {
  const manual = createJob();
  const recurring: Cronjob = { ...manual, id: "recurring", schedule: { type: "interval", minutes: 5 }, nextFireAt: 1 };
  const fire = mock(() => null);
  const saveCronjobs = mock(() => {});
  const deps: CronjobSchedulerDeps = {
    getCronjobs: () => [manual, recurring],
    setCronjobs: () => {},
    loadCronjobs: () => [],
    saveCronjobs,
    loadCronjobsPrompt: () => null,
    setCronjobsPrompt: () => {},
    listAllCronjobIdsOnDisk: () => [],
    loadRuns: () => [],
    saveRuns: () => {},
    getUserByName: () => null,
    hasInFlightScheduledRun: () => false,
    recordSkippedRun: () => {
      throw new Error("Unexpected skipped run");
    },
    fire,
    emitEvent: () => {},
    tickIntervalMs: 60_000,
  };
  tickCronjobScheduler(deps, 1000);
  expect(fire).toHaveBeenCalledTimes(1);
  expect(fire).toHaveBeenCalledWith(recurring, "scheduled");
  manual.nextFireAt = 1;
  tickCronjobScheduler(deps, 2000);
  expect(fire).toHaveBeenCalledTimes(1);
  expect(saveCronjobs).toHaveBeenCalledTimes(1);
  expect(manual.lastFireAt).toBeNull();
});

test("Run now creates an attributed run for an on-demand job without arming a timer", () => {
  const job = createJob();
  // A missing directory records a failed run before any provider process starts.
  CronjobManager.updateCronjob(job.id, { cwd: join(CRONJOBS_DIR, "missing-" + crypto.randomUUID()) });
  const run = CronjobManager.runCronjobNow(job.id, "Owner");
  expect(run).toMatchObject({ trigger: "manual", triggeredBy: "Owner", status: "failed", promptSnapshot: "Check the release" });
  expect(CronjobManager.getRunsForCronjob(job.id).find((saved) => saved.id === run?.id)).toMatchObject({ trigger: "manual" });
  expect(loadCronjobs().find((saved) => saved.id === job.id)?.nextFireAt).toBeNull();
});
