import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("scheduled accounts select member homes and preserve legacy, resumed and forked stores", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-scheduled-accounts-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect } from "bun:test";
      import { writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { claimUserByName, updateUserById } from "./server/users.ts";
      import { officeConfig } from "./server/agents/state.ts";
      import { providerHomes } from "./server/provider-accounts/homes.ts";
      import { buildCronjobEnv, pinRunProviderEnvironment, buildRunResumeOptions } from "./server/cronjobs/session-options.ts";
      import { processNormalizedEvent } from "./server/cronjobs/run-events.ts";
      import { editRunMessageWithDeps } from "./server/cronjobs/run-edit.ts";
      import { appendRunLog, getRunSessionCodexHome, getRunSessionClaudeConfigDir, loadRunSessionsMap } from "./server/persistence.ts";
      const root=process.env.BUREAU_HOME;
      const member=claimUserByName("Member",{role:"owner"});
      const other=claimUserByName("Other",{role:"member"});
      const officeFile=join(root,"office.env");
      const officeCodex=join(root,"office-codex"),officeClaude=join(root,"office-claude");
      writeFileSync(officeFile,"CODEX_HOME="+officeCodex+"\\nCLAUDE_CONFIG_DIR="+officeClaude+"\\n");officeConfig.envFile=officeFile;
      for (const provider of ["claude","codex"]) {
        const key=provider==="claude"?"CLAUDE_CONFIG_DIR":"CODEX_HOME";
        const office=provider==="claude"?officeClaude:officeCodex;
        const home=providerHomes.home(member.id,provider);
        const read=provider==="claude"?getRunSessionClaudeConfigDir:getRunSessionCodexHome;
        expect(buildCronjobEnv(member.id)[key]).toBe(office);
        providerHomes.setActive(member.id,provider,true);
        expect(buildCronjobEnv(member.id)[key]).toBe(home);
        expect(buildCronjobEnv(other.id)[key]).toBe(office);
        expect(buildCronjobEnv(null)[key]).toBe(office);
        const run={id:"run-"+provider,cronjobId:"job",agentTypeSnapshot:provider,userIdSnapshot:member.id,cwdSnapshot:root,rootSessionId:"fresh",currentSessionId:"fresh"};
        expect(pinRunProviderEnvironment(run,"legacy",member.id,buildCronjobEnv(member.id))[key]).toBe(office);
        const active={jobId:run.cronjobId,runId:run.id,rootSessionId:"pending",sessionId:null,pendingEntries:[],launchedClaudeConfigDir:provider==="claude"?home:undefined,launchedCodexHome:provider==="codex"?home:undefined};
        processNormalizedEvent(active,{kind:"system_init",sessionId:"fresh"},()=>{});
        expect(read("job",run.id,"fresh")).toBe(home);
        providerHomes.setActive(member.id,provider,false);
        expect(buildCronjobEnv(member.id)[key]).toBe(office);
        const options=id=>buildRunResumeOptions({run,resumeSessionId:id,cronjobs:[],runToken:"run-token",buildSystemPrompt:()=>""});
        expect(options("fresh").env[key]).toBe(home);
        expect(options("fresh").env.BUREAU_AGENT_TOKEN).toBe("run-token");
        expect(options("legacy").env[key]).toBe(office);
        appendRunLog("job",run.id,"fresh",{id:"message",kind:"user_message",content:"change",timestamp:1,agentId:"test"});
        const accesses=[];
        const backend={
          getSessionMessages:async(id,cwd,access)=>{accesses.push(access.env[key]);return [{role:"user",text:"initial",uuid:"initial"},{role:"user",text:"change",uuid:"message"}]},
          forkSessionBeforeMessage:async(id,msg,access)=>{accesses.push(access.env[key]);return {kind:"fork",sessionId:"fork",forkedFromSessionId:id}},
          resumeSession:(id,opts)=>{accesses.push(opts.env[key]);expect(read("job",run.id,id)).toBe(home);return {send:async()=>{}}}
        };
        await editRunMessageWithDeps({cronRunBackend:()=>backend,buildRunResumeOptions:(_,id)=>options(id),emitRunErrorEntry:(_,__,error)=>{throw new Error(error)},installResumedActive:()=>({jobId:"job",runId:run.id,sessionId:"fork",streamId:"test",pendingEntries:[]}),finalizeRun:()=>{},revokeRunToken:()=>{},emitEvent:()=>{}},run,"message","edited","fresh");
        expect(accesses).toEqual([home,home,home]);
        expect(read("job",run.id,"fork")).toBe(home);
        expect(loadRunSessionsMap("job",run.id).fork.forkedFrom).toBe("fresh");
        providerHomes.setActive(member.id,provider,true);
        const memberFile=join(root,"member.env");writeFileSync(memberFile,key+"="+join(root,"explicit")+"\\n");updateUserById(member.id,{envFile:memberFile});
        expect(buildCronjobEnv(member.id)[key]).toBe(join(root,"explicit"));
        updateUserById(member.id,{envFile:null});
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
