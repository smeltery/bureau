import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "bun:test";
import type { NormalizedEvent } from "../../types.ts";
import { CodexSteering } from "./steering.ts";

test("steering requires a live turn and reports only matching receipts once", async () => {
  const state = { threadId: "thread", turnId: null as string | null, closed: false };
  const requests: unknown[] = [],
    events: NormalizedEvent[] = [];
  const steering = new CodexSteering(
    () => state,
    async (params) => {
      requests.push(params);
    },
    (event) => events.push(event),
  );
  expect(await steering.send("early", "early")).toBe(false);
  state.turnId = "turn";
  expect(await steering.send("guidance", "id")).toBe(true);
  expect(requests).toEqual([{ threadId: "thread", expectedTurnId: "turn", clientUserMessageId: "id", input: [{ type: "text", text: "guidance", text_elements: [] }] }]);
  steering.recorded({ type: "userMessage", clientId: "other" });
  expect(events).toHaveLength(0);
  steering.recorded({ type: "userMessage", clientId: "id" });
  steering.recorded({ type: "userMessage", clientId: "id" });
  expect(events).toEqual([{ kind: "steer_delivered", steerId: "id" }]);
  await steering.send("later", "later");
  steering.clear();
  steering.recorded({ type: "userMessage", clientId: "later" });
  expect(events).toHaveLength(1);
  state.closed = true;
  expect(await steering.send("closed", "closed")).toBe(false);
});

test("RPC refusal releases input but an uncertain transport failure retains its receipt", async () => {
  const events: NormalizedEvent[] = [];
  let refusal = true;
  const steering = new CodexSteering(
    () => ({ threadId: "thread", turnId: "turn", closed: false }),
    async () => {
      throw refusal ? Object.assign(new Error("wrong turn"), { code: -32602 }) : new Error("connection lost");
    },
    (event) => events.push(event),
  );
  expect(await steering.send("refused", "refused")).toBe(false);
  steering.recorded({ type: "userMessage", clientId: "refused" });
  expect(events).toHaveLength(0);
  refusal = false;
  expect(await steering.send("uncertain", "uncertain")).toBe(true);
  steering.recorded({ type: "userMessage", clientId: "uncertain" });
  expect(events).toHaveLength(1);
});

test("the Codex session wires turn steering and filters receipt notifications", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-codex-steering-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect } from "bun:test";
      import { JsonRpcLiteClient } from "./server/backends/codex/client.ts";
      import { CodexSession } from "./server/backends/codex/session.ts";
      let notify;const requests=[];
      JsonRpcLiteClient.prototype.onNotification=function(callback){notify=callback};
      JsonRpcLiteClient.prototype.start=function(){};
      JsonRpcLiteClient.prototype.initialize=async function(){};
      JsonRpcLiteClient.prototype.close=async function(){};
      JsonRpcLiteClient.prototype.request=async function(method,params){
        requests.push({method,params});
        if(method==="thread/start")return {thread:{id:"parent"}};
        if(method==="turn/start"){notify({method:"turn/started",params:{threadId:"parent",turn:{id:"turn"}}});return {turn:{id:"turn"}}}
        if(method==="turn/steer")return {turnId:"turn"};
        throw new Error("Unexpected RPC: "+method);
      };
      const session=new CodexSession({agentId:"a",cwd:process.cwd(),systemPrompt:"",modelFamily:"gpt-6.1-sol",effort:"high",permissionMode:"never"});
      const iterator=session.stream();expect((await iterator.next()).value.kind).toBe("system_init");
      expect(await session.steer("early","early")).toBe(false);
      await session.send("work");
      const command={type:"commandExecution",id:"cmd",command:"sleep 30",cwd:"/tmp"};
      notify({method:"item/started",params:{threadId:"parent",item:command}});
      expect((await iterator.next()).value).toMatchObject({kind:"tool_call",toolUseId:"cmd",input:{command:"sleep 30",cwd:"/tmp"}});
      expect(await session.steer("guidance","receipt")).toBe(true);
      const item={type:"userMessage",id:"item",clientId:"receipt",content:[]};
      notify({method:"item/started",params:{threadId:"child",item}});
      notify({method:"item/started",params:{threadId:"parent",item:{...item,clientId:"unknown"}}});
      notify({method:"item/started",params:{threadId:"parent",item}});
      notify({method:"item/completed",params:{threadId:"parent",item}});
      expect((await iterator.next()).value).toEqual({kind:"steer_delivered",steerId:"receipt"});
      await session.steer("unrecorded","old");
      notify({method:"turn/completed",params:{threadId:"parent",turn:{id:"turn",status:"completed"}}});
      notify({method:"item/completed",params:{threadId:"parent",item:{...item,clientId:"old"}}});
      expect(await session.steer("late","late")).toBe(false);
      notify({method:"item/completed",params:{threadId:"parent",item:{...command,exitCode:0,aggregatedOutput:"done"}}});
      session.close();const remaining=[];for await(const event of iterator)remaining.push(event);
      expect(remaining.filter(event=>event.kind==="steer_delivered")).toHaveLength(0);
      expect(remaining.filter(event=>event.kind==="tool_call")).toHaveLength(0);
      expect(remaining.filter(event=>event.kind==="tool_result")).toHaveLength(1);
      expect(requests.filter(request=>request.method==="turn/interrupt")).toHaveLength(0);
      expect(requests.find(request=>request.method==="turn/steer").params).toMatchObject({threadId:"parent",expectedTurnId:"turn",clientUserMessageId:"receipt"});
      process.exit(0);
    `,
      ],
      { env: { ...process.env, BUREAU_HOME: root }, timeout: 10000, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
