import { afterEach, expect, spyOn, test } from "bun:test";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../../shared/types.ts";
import { codexBackend } from "../../../backends/codex/adapter.ts";
import type { BackendSession, NormalizedMessage } from "../../../backends/types.ts";
import { createManagedAgent } from "../../managed-factory.ts";
import { agents, logCache, persistAll } from "../../state.ts";
import { loadSessionsMap, ensureSessionCodexHome } from "../../../persistence.ts";
import { editMessage } from "../edit.ts";

afterEach(() => {
  agents.clear();
  logCache.clear();
  persistAll();
});

test("Codex edits branch at the selected message, including first and unsent inputs", async () => {
  for (const mode of ["first", "middle", "unsent"]) {
    const id = "edit-" + mode;
    const managed = createManagedAgent({
      info: {
        id,
        name: "Editor",
        agentType: "codex",
        capabilities: { ...DEFAULT_AGENT_CAPABILITIES, fork: false, edit: true },
        state: "waiting_for_response",
        cwd: process.cwd(),
        room: 0,
        desk: 0,
        modelFamily: "gpt-6.1-sol",
        permissionMode: "never",
        autoHandoff: false,
      } as AgentInfo,
      skillCwd: process.cwd(),
      slashCommands: [],
      skills: [],
    });
    managed.sessionId = "parent";
    ensureSessionCodexHome(id, "parent", "/tmp/bureau-edit-account-" + mode);
    const sent: string[] = [];
    const session: BackendSession = {
      async *stream() {},
      async send(text) {
        sent.push(text);
        const turn = managed.pendingTurn;
        managed.pendingTurn = null;
        turn?.resolve();
      },
      async getContextUsage() {
        return null;
      },
      async approve() {},
      async abort() {},
      close() {},
      canAbortInPlace() {
        return false;
      },
    };
    managed.session = session;
    agents.set(id, managed);
    const first = { id: "first", agentId: id, kind: "user_message" as const, content: "repeat", timestamp: 1 };
    const target = { id: "target", agentId: id, kind: "user_message" as const, content: "repeat", timestamp: 3 };
    logCache.set(id, mode === "first" ? [target] : [first, { id: "reply", agentId: id, kind: "text", content: "reply", timestamp: 2 }, target]);
    const history: NormalizedMessage[] =
      mode === "first"
        ? [{ uuid: "u1", role: "user", text: "repeat" }]
        : [{ uuid: "u1", role: "user", text: "repeat" }, { uuid: "a1", role: "assistant", text: "reply" }, ...(mode === "middle" ? [{ uuid: "u2", role: "user" as const, text: "repeat" }] : [])];
    if (mode === "unsent") {
      managed.info.state = "stopped";
      logCache.get(id)!.push({ id: "stopped", agentId: id, kind: "system", content: "Interrupted", timestamp: 4 });
    }
    const read = spyOn(codexBackend, "getSessionMessages").mockResolvedValue(history);
    const fork = spyOn(codexBackend, "forkSessionBeforeMessage").mockResolvedValue({ kind: "fork", sessionId: "child-" + mode, forkedFromSessionId: "parent" });
    const resume = spyOn(codexBackend, "resumeSession").mockReturnValue(session);
    const resumable = spyOn(codexBackend, "checkSessionResumable").mockReturnValue(null);
    try {
      await editMessage(id, "target", "replacement");
      expect(fork).toHaveBeenCalledTimes(1);
      expect(fork.mock.calls[0]![1]).toBe(mode === "first" ? "u1" : mode === "middle" ? "u2" : null);
      expect(fork.mock.calls[0]![2]?.env?.CODEX_HOME).toBe("/tmp/bureau-edit-account-" + mode);
      expect(read.mock.calls[0]![2]?.env?.CODEX_HOME).toBe("/tmp/bureau-edit-account-" + mode);
      expect(loadSessionsMap(id)["child-" + mode]?.codexHome).toBe("/tmp/bureau-edit-account-" + mode);
      expect(managed.sessionId).toBe("child-" + mode);
      expect(sent).toHaveLength(1);
      expect(sent[0]).toContain("replacement");
      expect(loadSessionsMap(id)["child-" + mode]?.forkedFrom).toBe("parent");
      expect(
        logCache
          .get(id)
          ?.filter((e) => e.kind === "user_message")
          .map((e) => e.content),
      ).toEqual(mode === "first" ? ["replacement"] : ["repeat", "replacement"]);
    } finally {
      read.mockRestore();
      fork.mockRestore();
      resume.mockRestore();
      resumable.mockRestore();
    }
  }
});
