import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

test("stored placeholders normalize on read without changing history order or disk contents", () => {
  const home = mkdtempSync(join(tmpdir(), "bureau-topic-migration-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect } from "bun:test";
      import { mkdirSync, writeFileSync, readFileSync } from "node:fs";
      import { join } from "node:path";
      import { AGENTS_FILE, AGENT_HISTORY_FILE, LOGS_DIR } from "./server/persistence/paths.ts";
      import { loadAgents } from "./server/persistence/config/agents.ts";
      import { loadAgentHistory } from "./server/persistence/config/agent-history.ts";
      import { loadSessionsMap, listAgentSessions } from "./server/persistence/logs/sessions.ts";
      const directory = join(LOGS_DIR, "agent");
      mkdirSync(directory, { recursive: true });
      const topics = ["...", "  ", "Useful label"];
      const expected = [null, null, "Useful label"];
      const agents = topics.map((topic, i) => ({id: "agent-" + i, name: "Agent", modelFamily: "sonnet", topic, topicGenerating: true}));
      const history = Object.fromEntries(agents.map(a => [a.id, { name: a.name, topic: a.topic }]));
      const sessions = Object.fromEntries(topics.map((topic, i) => ["session-" + i, { topic, lastModified: i + 1 }]));
      const agentBytes = JSON.stringify([{ id: "room", name: "Room", agents }]);
      const historyBytes = JSON.stringify(history);
      const sessionBytes = JSON.stringify(sessions);
      writeFileSync(AGENTS_FILE, agentBytes);
      writeFileSync(AGENT_HISTORY_FILE, historyBytes);
      writeFileSync(join(directory, "sessions.json"), sessionBytes);
      for (let i = 0; i < topics.length; i++) writeFileSync(join(directory, "session-" + i + ".jsonl"), "");
      const loaded = loadAgents()[0].agents;
      expect(loaded.map(a => a.topic)).toEqual(expected);
      expect(loaded.every(a => a.topicGenerating === undefined)).toBe(true);
      expect(Object.values(loadAgentHistory()).map(a => a.topic)).toEqual(expected);
      expect(Object.values(loadSessionsMap("agent")).map(a => a.topic)).toEqual(expected);
      expect(listAgentSessions("agent").map(s => [s.sessionId, s.lastModified, s.topic])).toEqual([["session-2",3,"Useful label"],["session-1",2,null],["session-0",1,null]]);
      expect(readFileSync(AGENTS_FILE,"utf8")).toBe(agentBytes);
      expect(readFileSync(AGENT_HISTORY_FILE,"utf8")).toBe(historyBytes);
      expect(readFileSync(join(directory,"sessions.json"),"utf8")).toBe(sessionBytes);
    `,
      ],
      { env: { ...process.env, BUREAU_HOME: home }, stdout: "pipe", stderr: "pipe" },
    );
    expect(result.exitCode, result.stderr.toString()).toBe(0);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
