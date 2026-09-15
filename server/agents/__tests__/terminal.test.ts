import { afterEach, describe, expect, mock, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir, homedir, userInfo } from "os";
import { join } from "path";

import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import { createManagedAgent } from "../managed-factory.ts";
import { openTerminal } from "../terminal.ts";
import { agents, setOfficeConfig, setRooms } from "../state.ts";

let tempDir: string | null = null;

afterEach(() => {
  mock.restore();
  agents.clear();
  setRooms([{ id: "room-default", name: "Room 1", prompt: null, envFile: null, pet: null }]);
  setOfficeConfig({ prompt: null, envFile: null, publicOrigin: null, externalAccess: null, networkBind: "auto", officeName: null, previewAllowHosts: [], experimental: { browserPanel: false } });
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = null;
});

function envFile(contents: string): string {
  tempDir ??= mkdtempSync(join(tmpdir(), "bureau-terminal-test-"));
  const path = join(tempDir, `env-${Math.random().toString(16).slice(2)}.env`);
  writeFileSync(path, contents);
  return path;
}

function installAgent(envPath: string | null = null) {
  const info: AgentInfo = {
    id: "agent-terminal",
    name: "Terminal",
    desk: 0,
    room: 0,
    roomId: "room-default",
    cwd: tempDir ?? tmpdir(),
    outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
    permissionMode: "default",
    modelFamily: "sonnet",
    agentType: "claude",
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: null,
    effort: "high",
  };
  setRooms([{ id: "room-default", name: "Room 1", prompt: null, envFile: envPath, pet: null }]);
  agents.set(info.id, createManagedAgent({ info, skillCwd: process.cwd(), slashCommands: [], skills: [] }));
}

function mockSpawn() {
  const write = mock((data: string) => data.length);
  const spawn = spyOn(Bun, "spawn").mockReturnValue({
    stdin: { write },
    stdout: new ReadableStream({
      start(controller) {
        controller.close();
      },
    }),
    exited: new Promise<number>(() => {}),
    pid: 123,
  } as unknown as ReturnType<typeof Bun.spawn>);
  return { spawn, env: () => JSON.parse(write.mock.calls[0][0]).env };
}

describe("terminal environment", () => {
  test("inherits configured env files and keeps shell overlay values", () => {
    const officeEnv = envFile("TERMINAL_SCOPE=office\nTERM=managed\n");
    const roomEnv = envFile("TERMINAL_SCOPE=room\nPATH=/managed/path\n");
    setOfficeConfig({ prompt: null, envFile: officeEnv, publicOrigin: null, externalAccess: null, networkBind: "auto", officeName: null, previewAllowHosts: [], experimental: { browserPanel: false } });
    installAgent(roomEnv);
    const f = mockSpawn();

    expect(openTerminal("agent-terminal")).toBe(true);

    expect(f.env()).toMatchObject({
      TERMINAL_SCOPE: "room",
      TERM: "xterm-256color",
      SHELL: process.env.SHELL || "/bin/bash",
      HOME: homedir(),
      USER: process.env.USER || userInfo().username,
      LANG: process.env.LANG || "en_US.UTF-8",
      PATH: process.env.PATH || "/usr/local/bin:/usr/bin:/bin",
    });
  });

  test("exits without spawning when env loading fails", () => {
    installAgent(join(tmpdir(), "missing-terminal-env.env"));
    const spawn = spyOn(Bun, "spawn");
    const warn = spyOn(console, "warn").mockImplementation(() => {});

    expect(openTerminal("agent-terminal")).toBe(false);

    expect(spawn).not.toHaveBeenCalled();
    expect(warn.mock.calls[0][0]).toBe("[terminal] cannot open PTY for agent-terminal:");
    expect(agents.get("agent-terminal")?.ptySidecar).toBeNull();
  });
});
