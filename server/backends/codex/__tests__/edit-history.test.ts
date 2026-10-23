import { expect, test } from "bun:test";

test("Codex edits use the target turn, preserve full-history forks and carry account access", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { expect } from "bun:test";
    import { codexBackend } from "./server/backends/codex/adapter.ts";
    import { JsonRpcLiteClient } from "./server/backends/codex/client.ts";
    const clients=[], calls=[];
    let closed=0;
    JsonRpcLiteClient.prototype.start=function(){ clients.push(this.opts); };
    JsonRpcLiteClient.prototype.initialize=async function(){};
    JsonRpcLiteClient.prototype.close=async function(){ closed++; };
    JsonRpcLiteClient.prototype.request=async function(method,params){
      calls.push({method,params});
      if(method==="thread/turns/list")return params.cursor ? {data:[{id:"t2"}]} : {data:[{id:"t1"}],nextCursor:"next"};
      if(method==="thread/items/list")return {data:[
        {turnId:"t1",item:{type:"userMessage",id:"u1",content:[{type:"text",text:"first"}]}},
        {turnId:"t1",item:{type:"agentMessage",id:"a1",text:"reply"}},
        {turnId:"t2",item:{type:"userMessage",id:"u2",content:[{type:"text",text:"second"}]}}
      ]};
      if(method==="thread/fork")return {thread:{id:"child-"+calls.length}};
      throw new Error("Unexpected mutation: "+method);
    };
    const access={cwd:"/private/work",env:{CODEX_HOME:"/private/member/codex"}};
    expect((await codexBackend.getSessionMessages("parent","/fallback",access)).map(m=>m.text)).toEqual(["first","reply","second"]);
    for(const [target,turn] of [["u1","t1"],["u2","t2"],[null,undefined]]){
      const before=calls.length;
      const branch=await codexBackend.forkSessionBeforeMessage("parent",target,access);
      expect(branch).toMatchObject({kind:"fork",forkedFromSessionId:"parent"});
      const request=calls.at(-1);
      expect(request.method).toBe("thread/fork");
      expect(request.params).toEqual({threadId:"parent",excludeTurns:true,...(turn?{beforeTurnId:turn}:{})});
      if(target===null)expect(calls.length-before).toBe(1);
    }
    const forks=calls.filter(c=>c.method==="thread/fork").length;
    await expect(codexBackend.forkSessionBeforeMessage("parent","missing",access)).rejects.toThrow("not found");
    expect(calls.filter(c=>c.method==="thread/fork")).toHaveLength(forks);
    expect(clients.every(options=>options.cwd===access.cwd&&options.env.CODEX_HOME===access.env.CODEX_HOME)).toBe(true);
    await codexBackend.getSessionMessages("parent","/fallback");
    expect(clients.at(-1).cwd).toBe("/fallback");
    expect(closed).toBe(clients.length);
  `,
    ],
    { env: process.env, stdout: "pipe", stderr: "pipe", timeout: 10000 },
  );
  expect(result.exitCode, result.stderr.toString()).toBe(0);
});
