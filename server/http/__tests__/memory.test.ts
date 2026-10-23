import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { _testResetAgentTokens, mintAgentToken } from "../../agents/tokens.ts";
import type { AuthResult } from "../../auth/auth-middleware.ts";
import { MEMORY_CAPS, parseMemoryLine } from "../../memory-store.ts";
import { handleMemoryRequest } from "../memory.ts";

const auth: AuthResult = {
  kind: "ok",
  session: {
    sessionIdHash: "hash",
    sessionPrefix: "sess",
    userId: "user-1",
    username: "Boss",
    role: "owner",
    needsRolling: false,
    absoluteExpiresAt: Date.now() + 86_400_000,
  },
};

afterEach(() => {
  _testResetAgentTokens();
});

describe("handleMemoryRequest", () => {
  test("returns null for unrelated api routes", async () => {
    const req = new Request("http://local.test/api/tasks");

    await expect(handleMemoryRequest(req, new URL(req.url), auth)).resolves.toBeNull();
  });

  test("requires an authenticated caller", async () => {
    const req = new Request("http://local.test/api/memory?scope=office");

    const res = await handleMemoryRequest(req, new URL(req.url), { kind: "loopback" });

    expect(res?.status).toBe(401);
    expect(await res?.json()).toEqual({
      error: { code: "unauthenticated", message: "authenticated caller required" },
    });
  });

  test("allows browser sessions to read memory", async () => {
    const req = new Request("http://local.test/api/memory?scope=office");

    const res = await handleMemoryRequest(req, new URL(req.url), auth);
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(typeof body.text).toBe("string");
    expect(typeof body.version).toBe("string");
    expect(body.size).toBe(0);
    expect(body.cap).toBe(MEMORY_CAPS.office);
  });

  test("allows authenticated agent tokens to read office memory", async () => {
    const token = mintAgentToken("agent-1", "user-1");
    const req = new Request("http://local.test/api/memory?scope=office", {
      headers: { Authorization: `Bearer ${token}` },
    });

    const res = await handleMemoryRequest(req, new URL(req.url), { kind: "loopback" });
    const body = await res?.json();

    expect(res?.status).toBe(200);
    expect(typeof body.text).toBe("string");
    expect(typeof body.version).toBe("string");
  });

  test("parses authorless self-authored agent memory lines", () => {
    expect(parseMemoryLine("- 2026-08-03: remember this", "agent", "agent-1")).toEqual({
      scope: "agent",
      scopeId: "agent-1",
      author: null,
      date: "2026-08-03",
      text: "remember this",
      raw: "- 2026-08-03: remember this",
    });
  });
});

test("memory reads identify explicit and implicit targets without changing stored scope keys", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-memory-target-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect } from "bun:test";
      import { agents, rooms } from "./server/agents/state.ts";
      import { createManagedAgent } from "./server/agents/managed-factory.ts";
      import { claimUserByName } from "./server/users.ts";
      import { mintAgentToken } from "./server/agents/tokens.ts";
      import { handleMemoryRequest } from "./server/http/memory.ts";
      const member=claimUserByName("Owner",{role:"owner"});
      const info={id:"memory-agent",name:"Archivist",room:0,userId:member.id,cwd:process.cwd(),agentType:"claude",state:"idle"};
      agents.set(info.id,createManagedAgent({info,skillCwd:process.cwd(),skills:[],slashCommands:[]}));
      const token=mintAgentToken(info.id,member.id);
      const auth={kind:"ok",session:{userId:member.id,username:member.name,role:"owner"}};
      async function read(query,bearer=false){const url=new URL("http://office.test/api/memory"+query);const response=await handleMemoryRequest(new Request(url,{headers:bearer?{Authorization:"Bearer "+token}:{}}),url,auth);return {status:response.status,body:await response.json()};}
      expect((await read("?scope=office")).body).toMatchObject({scope:"office",scopeId:null,name:null});
      expect((await read("",true)).body).toMatchObject({scope:"agent",scopeId:info.id,name:"Archivist"});
      expect((await read("?scope=agent&scopeId="+info.id)).body).toMatchObject({scope:"agent",scopeId:info.id,name:"Archivist"});
      expect((await read("?scope=room&scopeId="+rooms[0].id)).body).toMatchObject({scope:"room",scopeId:rooms[0].id,name:rooms[0].name});
      expect((await read("?scope=boss",true)).body).toMatchObject({scope:"boss",scopeId:member.id,name:member.name});
      expect((await read("?scope=boss")).body).toMatchObject({scope:"boss",scopeId:member.id,name:member.name});
      expect((await read("?scope=agent&scopeId=missing")).status).toBe(404);
      agents.get(info.id).info.name="Renamed";expect((await read("",true)).body.name).toBe("Renamed");
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
