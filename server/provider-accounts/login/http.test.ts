import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("provider login routes retain browser identity, scope permissions and revocation checks", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-provider-http-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect } from "bun:test";
      import { claimUserByName, setUserRoleById } from "./server/users.ts";
      import { handleProviderLogin } from "./server/provider-accounts/login/http.ts";
      const owner=claimUserByName("Owner",{role:"owner"});const member=claimUserByName("Member",{role:"member"});
      const identity=user=>({kind:"ok",session:{userId:user.id,role:user.role}});
      let auth=identity(member),calls=0;
      const manager={status:async()=>({phase:"idle"}),start:async()=>{calls++;return{phase:"waiting",authUrl:"https://claude.ai/login"}},callback:async()=>{calls++},cancel:async()=>{calls++},disconnect:async()=>{calls++}};
      const run=(scope,method="GET",body={},headers={})=>{const url=new URL("http://localhost/api/me/provider-accounts/claude/login"+(scope===null?"":"?scope="+scope));return handleProviderLogin(new Request(url,{method,headers,...(method!=="GET"?{body:JSON.stringify(body)}:{})}),url,()=>auth,manager)};
      expect((await run(null)).status).toBe(422);expect((await run("other")).status).toBe(422);
      expect((await run("personal","POST",{method:"browser"})).status).toBe(200);expect(calls).toBe(1);
      expect((await run("office","POST",{method:"browser"})).status).toBe(403);
      expect((await run("office")).status).toBe(200);
      expect((await run("personal","POST",{}, {authorization:"Bearer invalid"})).status).toBe(401);
      auth={kind:"loopback"};expect((await run("personal","POST")).status).toBe(401);
      auth=identity(owner);setUserRoleById(owner.id,"member");expect((await run("office","POST")).status).toBe(403);
      auth=identity(member);manager.start=async()=>{auth={kind:"loopback"};return{authUrl:"private-login-address"}};
      const revoked=await run("personal","POST",{method:"browser"});expect(revoked.status).toBe(403);expect(await revoked.text()).not.toContain("private-login-address");
      auth=identity(member);expect((await run("personal","PUT",{code:"secret"})).status).toBe(400);
      expect((await run("personal","POST",{method:"device"})).status).toBe(400);
      auth=identity(member);manager.status=async()=>{auth={kind:"loopback"};return{authUrl:"private-login-address"}};
      const late=await run("personal","DELETE",{operationId:"active"});expect(late.status).toBe(403);expect(await late.text()).not.toContain("private-login-address");
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
