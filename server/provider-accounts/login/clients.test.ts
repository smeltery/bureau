import { expect, test } from "bun:test";
import { mkdtempSync, existsSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CodexAccountClient } from "./codex-client.ts";
import { ClaudeAccountClient, parseClaudeCallback } from "./claude-client.ts";
import { JsonRpcLiteClient } from "../../backends/codex/client.ts";
import { accountLoginUrl } from "./types.ts";

test("Codex login matches early completion notifications and closes its real transport process", async () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-account-client-"));
  const script = join(root, "fixture.ts");
  writeFileSync(
    script,
    `let connected=false;const send=v=>console.log(JSON.stringify(v));for await(const line of console){const req=JSON.parse(line);if(!req.id)continue;let result={};if(req.method==='account/read')result={account:connected?{type:'chatgpt',email:'member@example.test'}:null};if(req.method==='account/login/start'){connected=true;send({method:'account/login/completed',params:{loginId:'wrong',success:false}});send({method:'account/login/completed',params:{loginId:'login',success:true}});result={type:'chatgptDeviceCode',loginId:'login',verificationUrl:'https://auth.openai.com/codex/device',userCode:'ABCD-1234'}}if(req.method==='account/logout')connected=false;send({id:req.id,result})}`,
  );
  const transport = new JsonRpcLiteClient({ codexBin: process.execPath, args: [script], env: { PATH: process.env.PATH, HOME: root, CODEX_HOME: root } });
  const client = new CodexAccountClient(transport);
  try {
    await client.start();
    expect((await client.read()).connected).toBe(false);
    expect(await client.login("device")).toMatchObject({ loginId: "login", userCode: "ABCD-1234" });
    await client.complete();
    expect((await client.read()).connected).toBe(true);
    await client.logout();
    expect((await client.read()).connected).toBe(false);
  } finally {
    await client.close();
    rmSync(root, { recursive: true, force: true });
  }
});
test("Claude login keeps tools isolated and validates pasted callback state", async () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-claude-account-"));
  let options: any,
    closed = false;
  const callbacks: unknown[] = [];
  const client = new ClaudeAccountClient({ CLAUDE_CONFIG_DIR: root }, (request) => {
    options = request.options;
    return {
      accountInfo: async () => ({ apiProvider: "firstParty", tokenSource: "oauth", email: "member@example.test" }),
      claudeAuthenticate: async () => ({ manualUrl: "https://claude.ai/oauth/authorize?state=expected" }),
      claudeOAuthCallback: async (...args: unknown[]) => {
        callbacks.push(args);
      },
      claudeOAuthWaitForCompletion: async () => {},
      close: () => {
        closed = true;
      },
    };
  });
  try {
    await client.start();
    expect((await client.read()).connected).toBe(true);
    expect(options).toMatchObject({ tools: [], agents: {}, mcpServers: {}, plugins: [], settingSources: [], strictMcpConfig: true, settings: { disableClaudeAiConnectors: true } });
    await client.login("browser");
    await expect(client.callback("secret#wrong")).rejects.toThrow("does not match");
    expect(callbacks).toEqual([]);
    await client.callback("secret#expected");
    expect(callbacks).toEqual([["secret", "expected"]]);
    writeFileSync(join(root, ".credentials.json"), "private");
    await client.logout();
    expect(existsSync(join(root, ".credentials.json"))).toBe(false);
  } finally {
    await client.close();
    expect(closed).toBe(true);
    rmSync(root, { recursive: true, force: true });
  }
});
test("unsupported Claude versions fail cleanly and external login URLs are constrained", async () => {
  let closed = false;
  const client = new ClaudeAccountClient({}, () => ({
    close: () => {
      closed = true;
    },
  }));
  await expect(client.start()).rejects.toThrow("does not support");
  expect(closed).toBe(true);
  for (const address of ["http://auth.openai.com/", "https://untrusted.example/", "https://user:password@auth.openai.com/", "https://auth.openai.com:444/"])
    expect(() => accountLoginUrl(address, "codex")).toThrow();
  expect(parseClaudeCallback("https://claude.ai/callback?code=code&state=expected", "expected")).toEqual({ code: "code", state: "expected" });
  expect(() => parseClaudeCallback("code#wrong", "expected")).toThrow();
});
