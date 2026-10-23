import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("personal account targets isolate members and preserve existing session credential roots", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-provider-isolation-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect } from "bun:test";
      import { existsSync, mkdirSync, symlinkSync, writeFileSync } from "node:fs";
      import { join } from "node:path";
      import { claimUserByName, updateUserById } from "./server/users.ts";
      import { resolveAccountTarget } from "./server/provider-accounts/login/targets.ts";
      import { providerHomes } from "./server/provider-accounts/homes.ts";
      import { buildSessionEnv } from "./server/agents/session/session-env.ts";
      import { pinProviderEnvironment } from "./server/agents/session/provider-environment.ts";
      import { ensureSessionCodexHome, getSessionCodexHome } from "./server/persistence.ts";
      import { officeConfig } from "./server/agents/state.ts";
      const root=process.env.BUREAU_HOME;
      const owner=claimUserByName("Owner",{role:"owner"}); const member=claimUserByName("Member",{role:"member"});
      const other=claimUserByName("Other",{role:"member"});
      const office=join(root,"office-codex"); mkdirSync(office); const officeFile=join(root,"office.env"); writeFileSync(officeFile,"CODEX_HOME="+office+"\\nOPENAI_API_KEY=office-key\\n"); officeConfig.envFile=officeFile;
      const personal=resolveAccountTarget(member.id,"codex","personal");
      expect(personal.managed).toBe(true);expect(personal.env.OPENAI_API_KEY).toBeUndefined();expect(personal.apiKeyPresent).toBe(true);
      expect(existsSync(personal.directory)).toBe(false);
      const managed={info:{id:"agent",userId:member.id,agentType:"codex",room:0}};
      expect(buildSessionEnv(managed).CODEX_HOME).toBe(office);
      providerHomes.ensure(member.id,"codex"); providerHomes.setActive(member.id,"codex",true);
      expect(buildSessionEnv(managed).CODEX_HOME).toBe(providerHomes.home(member.id,"codex"));
      expect(pinProviderEnvironment(managed,"legacy-session",buildSessionEnv(managed)).CODEX_HOME).toBe(office);
      expect(getSessionCodexHome("agent","legacy-session")).toBe(office);
      ensureSessionCodexHome("agent","new-session",personal.directory);
      providerHomes.setActive(member.id,"codex",false);
      expect(pinProviderEnvironment(managed,"new-session",buildSessionEnv(managed)).CODEX_HOME).toBe(personal.directory);
      const memberFile=join(root,"member.env");updateUserById(member.id,{envFile:memberFile});
      writeFileSync(memberFile,"CODEX_HOME="+office+"\\n");expect(()=>resolveAccountTarget(member.id,"codex","personal",true)).toThrow("separate");
      const alias=join(root,"alias");symlinkSync(office,alias);writeFileSync(memberFile,"CODEX_HOME="+alias+"\\n");expect(()=>resolveAccountTarget(member.id,"codex","personal",true)).toThrow("separate");
      writeFileSync(memberFile,"CODEX_HOME="+providerHomes.home(other.id,"codex")+"\\n");expect(()=>resolveAccountTarget(member.id,"codex","personal",true)).toThrow("another account");
      const explicit=join(root,"unique");writeFileSync(memberFile,"CODEX_HOME="+explicit+"\\n");expect(resolveAccountTarget(member.id,"codex","personal").managed).toBe(false);
      const otherFile=join(root,"other.env");writeFileSync(otherFile,"CODEX_HOME="+explicit+"\\n");updateUserById(other.id,{envFile:otherFile});expect(()=>resolveAccountTarget(member.id,"codex","personal",true)).toThrow("unique");
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
