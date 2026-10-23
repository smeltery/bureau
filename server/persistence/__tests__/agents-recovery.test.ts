import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

function isolated(script: string) {
  const home = mkdtempSync(join(tmpdir(), "bureau-agents-recovery-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect, spyOn } from "bun:test";
      import * as fs from "node:fs";
      import { AGENTS_FILE, BUREAU_DIR } from "./server/persistence/paths.ts";
      import { loadAgents, saveAgents } from "./server/persistence/config/agents.ts";
      const agent = { id: "saved-agent", name: "Saved agent", model: "claude-opus-4-6" };
      ${script}
    `,
      ],
      { env: { ...process.env, BUREAU_HOME: home }, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.stderr.toString()).not.toContain("private prompt marker");
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
}

test("missing and deliberately empty state start a room without quarantine", () => {
  isolated(`
    expect(loadAgents()[0].agents).toEqual([]);
    fs.writeFileSync(AGENTS_FILE, "[]");
    expect(loadAgents()[0].agents).toEqual([]);
    expect(fs.readdirSync(BUREAU_DIR).filter(name => name.includes(".corrupt-"))).toEqual([]);
  `);
});

test("room, nested-array and flat-agent formats retain identities and migrate models", () => {
  isolated(`
    for (const value of [[agent], [[agent]], [{ id: "room-id", name: "Project", agents: [agent] }]]) {
      fs.writeFileSync(AGENTS_FILE, JSON.stringify(value));
      const rooms = loadAgents();
      expect(rooms[0].agents[0].id).toBe("saved-agent");
      expect(rooms[0].agents[0].modelFamily).toBe("opus");
      expect(rooms[0].prompt).toBeNull();
      saveAgents(rooms);
      expect(loadAgents()).toEqual(rooms);
    }
    expect(loadAgents()[0].id).toBe("room-id");
  `);
});

test("damaged JSON and invalid structures preserve original bytes across saves and retries", () => {
  isolated(`
    const inputs = ["private prompt marker", "null", "{}", "[null]", '[{"name":"Room","agents":null}]', '[{"name":"Room","agents":[null]}]', '[[],null]'];
    for (const content of inputs) {
      fs.writeFileSync(AGENTS_FILE, content);
      const rooms = loadAgents();
      expect(rooms[0].agents).toEqual([]);
      expect(fs.existsSync(AGENTS_FILE)).toBe(false);
      saveAgents(rooms);
    }
    const copies = fs.readdirSync(BUREAU_DIR).filter(name => name.startsWith("agents.json.corrupt-"));
    expect(copies.length).toBe(inputs.length);
    expect(copies.map(name => fs.readFileSync(BUREAU_DIR + "/" + name, "utf8")).sort()).toEqual(inputs.sort());
    expect(loadAgents()[0].agents).toEqual([]);
  `);
});

test("read errors abort startup without replacing the state path", () => {
  isolated(`
    fs.mkdirSync(AGENTS_FILE);
    expect(() => loadAgents()).toThrow("Cannot read agents.json");
    expect(fs.statSync(AGENTS_FILE).isDirectory()).toBe(true);
  `);
});

test("failure to preserve damaged state aborts startup and retains the original", () => {
  isolated(`
    fs.writeFileSync(AGENTS_FILE, "broken");
    const copy = spyOn(fs, "copyFileSync").mockImplementation(() => { throw new Error("disk full"); });
    try {
      expect(() => loadAgents()).toThrow("Cannot preserve damaged agents.json");
      expect(fs.readFileSync(AGENTS_FILE, "utf8")).toBe("broken");
    } finally { copy.mockRestore(); }
  `);
});
