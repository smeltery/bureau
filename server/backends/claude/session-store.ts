import type { SessionStore, SessionStoreEntry } from "@anthropic-ai/claude-agent-sdk";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { claudeProjectDir } from "../../agents/session/paths.ts";

export function claudeSessionStore(sessionId: string, cwd: string, env?: Record<string, string | undefined>): SessionStore {
  const projectDir = claudeProjectDir(cwd, env ?? process.env);
  return {
    async load(key) {
      if (key.sessionId !== sessionId || key.subpath) throw new Error("Cannot access this Claude conversation.");
      try {
        const text = await readFile(join(projectDir, `${sessionId}.jsonl`), "utf8");
        return text
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line) as SessionStoreEntry);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
        throw err;
      }
    },
    async append(key, entries) {
      if (key.sessionId === sessionId || key.subpath || !/^[0-9a-f-]{36}$/i.test(key.sessionId)) {
        throw new Error("Cannot access this Claude conversation.");
      }
      await writeFile(join(projectDir, `${key.sessionId}.jsonl`), entries.map((entry) => JSON.stringify(entry)).join("\n") + "\n", { flag: "wx", mode: 0o600 });
    },
  };
}
