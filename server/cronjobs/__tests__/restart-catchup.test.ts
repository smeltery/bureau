import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("restart preserves one overdue slot, repairs interrupted runs and advances after one catch-up", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-schedule-restart-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
        import { expect } from "bun:test";
        import { startCronjobSchedulerWithDeps, tickCronjobScheduler } from "./server/cronjobs/scheduler.ts";
        const now = Date.now();
        Date.now = () => now;
        const day = 86400000;
        const base = { enabled:true, createdAt:now-30*day, lastFireAt:now-20*day, nextFireAt:now-10*day, name:"Check", userId:"owner" };
        const schedules = [{type:"interval",minutes:5},{type:"daily",hour:9,minute:0},{type:"weekly",weekday:1,hour:9,minute:0}];
        let jobs = schedules.map((schedule,i) => ({...base,id:"overdue-"+i,schedule}));
        jobs.push({...base,id:"boundary",schedule:schedules[0],nextFireAt:now});
        jobs.push({...base,id:"disabled",schedule:schedules[0],enabled:false});
        jobs.push({...base,id:"manual",schedule:{type:"manual"}});
        jobs.push({...base,id:"future",schedule:schedules[0],lastFireAt:now,nextFireAt:now+300000});
        jobs.push({...base,id:"legacy",schedule:schedules[0],nextFireAt:null});
        const runs = [{id:"interrupted",status:"running"},{id:"finished",status:"completed"}];
        let saved, repaired;
        const fired = [];
        const deps = {
          getCronjobs:()=>jobs, setCronjobs:value=>jobs=value, loadCronjobs:()=>jobs,
          saveCronjobs:value=>saved=structuredClone(value), loadCronjobsPrompt:()=>null, setCronjobsPrompt:()=>{},
          listAllCronjobIdsOnDisk:()=>["overdue-0"], loadRuns:()=>runs, saveRuns:(_,value)=>repaired=structuredClone(value),
          getUserByName:()=>null, hasInFlightScheduledRun:()=>false,
          recordSkippedRun:()=>{throw new Error("Unexpected overlap")},
          fire:(job,trigger)=>{fired.push([job.id,trigger]);return null}, emitEvent:()=>{}, tickIntervalMs:60000
        };
        startCronjobSchedulerWithDeps(deps);
        expect(jobs.slice(0,3).map(job=>job.nextFireAt)).toEqual([now-10*day,now-10*day,now-10*day]);
        expect(jobs[3].nextFireAt).toBe(now);
        expect(jobs[4].nextFireAt).toBeGreaterThan(now);
        expect(jobs[5].nextFireAt).toBeNull();
        expect(jobs[6].nextFireAt).toBe(now+300000);
        expect(jobs[7].nextFireAt).toBeGreaterThan(now);
        expect(repaired[0]).toMatchObject({status:"failed",endedAt:now,errorReason:"server restarted during run"});
        expect(repaired[1].status).toBe("completed");
        tickCronjobScheduler(deps,now);
        expect(fired).toEqual([...[0,1,2].map(i=>["overdue-"+i,"scheduled"]),["boundary","scheduled"]]);
        expect(saved.slice(0,4).every(job=>job.lastFireAt===now && job.nextFireAt>now)).toBe(true);
        tickCronjobScheduler(deps,now+1000);
        expect(fired.length).toBe(4);
        jobs = structuredClone(saved);
        startCronjobSchedulerWithDeps(deps);
        tickCronjobScheduler(deps,now);
        expect(fired.length).toBe(4);
        process.exit(0);
      `,
      ],
      { env: { ...process.env, BUREAU_HOME: root }, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
