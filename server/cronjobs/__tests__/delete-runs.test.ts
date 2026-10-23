import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("schedule deletion stops active runs, revokes pending forks and preserves history", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-delete-schedule-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect } from "bun:test";
      import { displayLogContent } from "./shared/i18n/log-message.ts";
      import * as Jobs from "./server/cronjobs/index.ts";
      import { getBackend } from "./server/backends/index.ts";
      import { claimUserByName } from "./server/users.ts";
      import { getRunToken, resolveRunToken } from "./server/cronjobs/tokens.ts";
      import { appendRunLog, findRun, loadRunLogWithAncestors } from "./server/persistence.ts";
      import { handleCronjobsRequest } from "./server/http/cronjobs.ts";
      const member=claimUserByName("Owner",{role:"owner"});
      const other=claimUserByName("Other",{role:"member"});
      const backend=getBackend("claude");
      const sessions=[];
      const events=[];
      Jobs.onCronjobEvent(event=>events.push(event));
      const settle=()=>new Promise(resolve=>setTimeout(resolve,0));
      function session(){
        let deliver;
        const s={closed:0,throwOnClose:false,send:async()=>{},close(){s.closed++;if(s.throwOnClose)throw new Error("close failed")},
          async *stream(){yield {kind:"system_init",sessionId:"session-"+sessions.length};yield await new Promise(resolve=>deliver=resolve)},
          late(){deliver({kind:"assistant_text",text:"late output"})}};
        sessions.push(s);return s;
      }
      backend.createSession=session;backend.resumeSession=session;backend.checkSessionResumable=()=>null;
      function job(){return Jobs.addCronjob({name:"Check",schedule:{type:"manual"},prompt:"check",cwd:process.cwd(),agentType:"claude",modelFamily:"opus",effort:"high",permissionMode:"bypassPermissions",userId:member.id,username:member.name})}
      async function remove(id,user=member){const req=new Request("http://office.test/api/cronjobs/"+id,{method:"DELETE"});return handleCronjobsRequest(req,new URL(req.url),{kind:"ok",session:{userId:user.id,username:user.name,role:user.role}})}
      const a=job(),b=job();
      const first=Jobs.runCronjobNow(a.id,"Owner"),second=Jobs.runCronjobNow(a.id,"Owner"),unrelated=Jobs.runCronjobNow(b.id,"Owner");
      await settle();
      const tokens=[first,second,unrelated].map(run=>getRunToken(run.id));
      expect((await remove(a.id,other)).status).toBe(404);
      expect(resolveRunToken(tokens[0])).not.toBeNull();
      sessions[0].throwOnClose=true;
      expect((await remove(a.id)).status).toBe(204);
      expect(sessions.map(s=>s.closed)).toEqual([1,1,0]);
      expect(resolveRunToken(tokens[0])).toBeNull();expect(resolveRunToken(tokens[1])).toBeNull();expect(resolveRunToken(tokens[2])).not.toBeNull();
      for(const run of [first,second])expect(findRun(a.id,run.id)).toMatchObject({status:"failed",errorReason:"schedule deleted"});
      const eventCount=events.length;sessions[0].late();sessions[1].late();await settle();expect(events.length).toBe(eventCount);
      expect(findRun(a.id,first.id).errorReason).toBe("schedule deleted");
      expect(loadRunLogWithAncestors(a.id,first.id,findRun(a.id,first.id).currentSessionId).some(e=>e.content.includes("Schedule deleted"))).toBe(true);
      const deletedNotice=loadRunLogWithAncestors(a.id,first.id,findRun(a.id,first.id).currentSessionId).find(e=>e.message?.key==="logs.run.deleted");
      expect(deletedNotice.content).toBe("Schedule deleted; this run was stopped.");
      expect(displayLogContent(deletedNotice,"es")).toContain("Se eliminó la programación");
      expect(Jobs.deleteCronjob(a.id)).toBe(false);
      Jobs.deleteCronjob(b.id);
      // A preserved run can still be resumed deliberately after its schedule is gone.
      await Jobs.sendRunMessage(a.id,second.id,"Follow up","Owner");
      expect(findRun(a.id,second.id).status).toBe("running");
      expect(sessions.at(-1).closed).toBe(0);
      // Deletion during either asynchronous edit stage must never start the fork.
      for(const stage of ["history","fork"]){
        const c=job(),run=Jobs.runCronjobNow(c.id,"Owner");await settle();
        sessions.at(-1).late();await settle();
        // Finish the fake stream so the run becomes resumable.
        expect(findRun(c.id,run.id).status).toBe("failed");
        const leaf=findRun(c.id,run.id).currentSessionId;
        appendRunLog(c.id,run.id,leaf,{id:"message",agentId:"test",timestamp:Date.now(),kind:"user_message",content:"change"});
        let unblock,entered;
        const reached=new Promise(resolve=>entered=resolve);
        const gate=new Promise(resolve=>unblock=resolve);
        backend.getSessionMessages=async()=>{if(stage==="history"){entered();await gate}return [{role:"user",text:"check",uuid:"initial"},{role:"user",text:"change",uuid:"message"}]};
        backend.forkSessionBeforeMessage=async()=>{if(stage==="fork"){entered();await gate}return {kind:"fork",sessionId:"fork",forkedFromSessionId:leaf}};
        const before=sessions.length;
        const pending=Jobs.editRunMessage(c.id,run.id,"message","edited","Owner");
        await reached;
        const token=getRunToken(run.id);expect(token).not.toBeNull();
        expect(Jobs.deleteCronjob(c.id)).toBe(true);expect(resolveRunToken(token)).toBeNull();
        unblock();await pending;
        expect(sessions.length).toBe(before);expect(getRunToken(run.id)).toBeNull();expect(findRun(c.id,run.id).currentSessionId).toBe(leaf);
        expect(loadRunLogWithAncestors(c.id,run.id,leaf).at(-1).message?.key).toBe("logs.run.pendingEditDeleted");
      }
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
