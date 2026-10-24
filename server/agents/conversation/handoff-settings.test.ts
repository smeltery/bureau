import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("handoff settings validate before mutation and survive spawn, persistence and revive", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-handoff-settings-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect } from "bun:test";
      import * as Agents from "./server/agent-manager.ts";
      import { agents } from "./server/agents/state.ts";
      import { getBackend } from "./server/backends/index.ts";
      import { claimUserByName } from "./server/users.ts";
      import { bindWsUser } from "./server/user-sockets.ts";
      import { handleAgentCommand } from "./server/ws/agent-commands.ts";
      import { handleAgentSpawnRequest } from "./server/http/agent-spawn-route.ts";
      import { handleAgentManagementRequest } from "./server/http/agent-management-routes.ts";
      import { buildRestoredAgentInfo } from "./server/agents/lifecycle-restore.ts";
      import { loadAgents, loadAgentHistory } from "./server/persistence.ts";
      const owner=claimUserByName("Owner",{role:"owner"});
      const auth={kind:"ok",session:{userId:owner.id,username:owner.name,role:"owner"}};
      for(const type of ["claude","codex","opencode"])getBackend(type).createSession=()=>{let close;const closed=new Promise(resolve=>close=resolve);return {async *stream(){await closed},close(){close()},async abort(){close()},async send(){},async approve(){},getContextUsage:async()=>null}};
      const room=Agents.getRooms()[0].id;
      async function spawn(body){return handleAgentSpawnRequest(new Request("http://office.test/api/agents",{method:"POST",body:JSON.stringify({name:"Automatic",cwd:process.cwd(),roomId:room,desk:0,...body})}),auth)}
      async function patch(id,body){return handleAgentManagementRequest(new Request("http://office.test/api/agents/"+id,{method:"PATCH",body:JSON.stringify(body)}),["agents",id],id,auth)}
      for(const value of [null,"250000",49999,10000001,1.5])expect((await spawn({autoHandoffTokens:value})).status).toBe(422);
      expect(Agents.getAllAgents()).toHaveLength(0);
      const response=await spawn({autoHandoff:true,autoHandoffTokens:250000});expect(response.status).toBe(201);
      const info=(await response.json()).agent;
      expect(info).toMatchObject({autoHandoff:true,autoHandoffTokens:250000});
      for(const value of [null,"250000",49999,10000001,1.5]){
        expect((await patch(info.id,{name:"Invalid",autoHandoffTokens:value})).status).toBe(422);
        expect(Agents.getAgent(info.id).name).toBe("Automatic");
      }
      const sent=[];const ws={send:message=>sent.push(JSON.parse(message))};bindWsUser(ws,owner);
      await handleAgentCommand({type:"edit_agent",requestId:"bad",agentId:info.id,name:"Invalid",autoHandoffTokens:NaN},ws);
      expect(sent.at(-1)).toMatchObject({requestId:"bad",ok:false,handoffIssue:"autoHandoffTokens"});expect(Agents.getAgent(info.id).name).toBe("Automatic");
      await handleAgentCommand({type:"spawn",requestId:"bad-spawn",name:"Invalid",cwd:process.cwd(),roomId:room,desk:1,autoHandoffTokens:Infinity},ws);
      expect(sent.at(-1)).toMatchObject({requestId:"bad-spawn",ok:false,handoffIssue:"autoHandoffTokens"});expect(Agents.getAllAgents()).toHaveLength(1);
      await handleAgentCommand({type:"edit_agent",requestId:"bad-flag",agentId:info.id,autoHandoff:"yes"},ws);
      expect(sent.at(-1)).toMatchObject({requestId:"bad-flag",ok:false,handoffIssue:"autoHandoff",error:"autoHandoff must be a boolean"});
      await handleAgentCommand({type:"edit_agent",requestId:"valid",agentId:info.id,autoHandoffTokens:123500},ws);
      expect(sent.at(-1)).toMatchObject({requestId:"valid",ok:true});
      expect(Agents.getAgent(info.id).autoHandoffTokens).toBe(123500);
      expect((await patch(info.id,{autoHandoff:false})).status).toBe(200);
      expect(Agents.getAgent(info.id)).toMatchObject({autoHandoff:false,autoHandoffTokens:123500});
      const saved=loadAgents().flatMap(room=>room.agents).find(agent=>agent.id===info.id);
      expect(buildRestoredAgentInfo(saved,0)).toMatchObject({autoHandoff:false,autoHandoffTokens:123500});
      for(const value of [undefined,null,-1,NaN,"bad"])expect(buildRestoredAgentInfo({...saved,autoHandoffTokens:value},0).autoHandoffTokens).toBe(500000);
      await Agents.kill(info.id);
      expect(loadAgentHistory()[info.id]).toMatchObject({autoHandoff:false,autoHandoffTokens:123500});
      const revived=await Agents.revive(info.id,room,0);expect(revived.ok).toBe(true);expect(revived.agent.autoHandoffTokens).toBe(123500);
      expect((await patch(info.id,{autoHandoff:true,autoHandoffTokens:10000000})).status).toBe(200);
      expect(Agents.getAgent(info.id)).toMatchObject({autoHandoff:true,autoHandoffTokens:10000000});
      await handleAgentCommand({type:"spawn",requestId:"spawn",name:"Second",cwd:process.cwd(),roomId:room,desk:1,permissionMode:"default",autoHandoff:true,autoHandoffTokens:50000},ws);
      expect(sent.at(-1)).toMatchObject({requestId:"spawn",ok:true});
      expect(Agents.getAllAgents().find(agent=>agent.name==="Second")).toMatchObject({autoHandoff:true,autoHandoffTokens:50000});
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
