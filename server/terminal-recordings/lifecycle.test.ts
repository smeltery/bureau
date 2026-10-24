import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("PTY close and replacement keep output and input attribution in their own recordings", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-recording-pty-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { expect, spyOn } from "bun:test";
      import { setupPrivilegedFixture, TARGET_AGENT } from "./server/http/__tests__/privileged-agent-fixture.ts";
      import { openTerminal, closeTerminal, terminalInput, getTerminalRecordingStatus } from "./server/agents/terminal.ts";
      import { saveRecordingEnabled } from "./server/terminal-recordings/store.ts";
      import { listRecordingIds, readRecording } from "./server/terminal-recordings/files.ts";
      import { withAuditContext } from "./server/audit/context.ts";
      const fixture = setupPrivilegedFixture(); saveRecordingEnabled(true);
      const { browsers } = await import("./server/ws/broadcast.ts");
      const { bindWsUser } = await import("./server/user-sockets.ts");
      const { wireAgentAndCronjobEvents } = await import("./server/ws/agent-events.ts");
      const { claimUserByName } = await import("./server/users.ts");
      const visibleMessages = [], hiddenMessages = [];
      const visibleSocket = { send(data) { visibleMessages.push(JSON.parse(data)); } };
      const hiddenSocket = { send(data) { hiddenMessages.push(JSON.parse(data)); } };
      const hiddenMember = claimUserByName("Hidden terminal viewer", { role: "member", allowedRooms: [fixture.hiddenRoomId] });
      bindWsUser(visibleSocket, fixture.manager); bindWsUser(hiddenSocket, hiddenMember);
      browsers.add(visibleSocket); browsers.add(hiddenSocket); wireAgentAndCronjobEvents();
      const controllers = [], exits = [];
      spyOn(Bun, "spawn").mockImplementation(() => ({
        stdin: { write() {} }, pid: 1,
        stdout: new ReadableStream({ start(controller) { controllers.push(controller); } }),
        exited: new Promise(resolve => exits.push(resolve)),
      }));
      const output = (index, data) => controllers[index].enqueue(new TextEncoder().encode(JSON.stringify({ type: "output", data }) + "\\n"));
      openTerminal(TARGET_AGENT);
      output(0, "first\\n"); await Bun.sleep(5);
      withAuditContext({ actor: "member:typer", operation: "terminal_input" }, () => terminalInput(TARGET_AGENT, "never-save-input-password"));
      closeTerminal(TARGET_AGENT);
      openTerminal(TARGET_AGENT);
      output(0, "stale-output\\n"); controllers[0].close(); exits[0](0);
      output(1, "second\\n"); await Bun.sleep(5);
      expect(getTerminalRecordingStatus(TARGET_AGENT)).toBe("recording");
      controllers[1].close(); exits[1](0); await Bun.sleep(5);
      const recordings = listRecordingIds().map(id => readRecording(id, false));
      expect(recordings).toHaveLength(2);
      expect(visibleMessages.some(event => event.type === "terminal_output")).toBe(true);
      expect(visibleMessages.some(event => event.type === "terminal_recording")).toBe(true);
      expect(hiddenMessages.filter(event => event.type.startsWith("terminal_"))).toEqual([]);
      const { sendToVisibleAgent } = await import("./server/ws/agent-events.ts");
      const beforeMissing = visibleMessages.length;
      sendToVisibleAgent("missing-agent", { type: "terminal_output", agentId: "missing-agent", data: "hidden" });
      expect(visibleMessages.length).toBe(beforeMissing);
      const text = JSON.stringify(recordings);
      expect(text).toContain("member:typer");
      expect(text).not.toContain("never-save-input-password");
      expect(text).not.toContain("stale-output");
      expect(recordings.every(view => view.events.filter(event => event.type === "end").length === 1)).toBe(true);
      expect(recordings.some(view => JSON.stringify(view).includes("first") && JSON.stringify(view).includes("second"))).toBe(false);
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

test("server termination flushes the pending output line and closes recordings", () => {
  const root = mkdtempSync(join(tmpdir(), "bureau-recording-shutdown-"));
  try {
    const result = Bun.spawnSync(
      [
        process.execPath,
        "--eval",
        `
      import { saveRecordingEnabled, startRecording } from "./server/terminal-recordings/store.ts";
      import { installRecordingShutdown } from "./server/terminal-recordings/shutdown.ts";
      saveRecordingEnabled(true); installRecordingShutdown();
      startRecording("agent", "room", () => {}).output("last prompt");
      setTimeout(() => process.kill(process.pid, "SIGTERM"), 10);
      setInterval(() => {}, 1000);
    `,
      ],
      { env: { ...process.env, BUREAU_HOME: root }, stdout: "pipe", stderr: "pipe", timeout: 5000 },
    );
    expect(result.exitCode).not.toBe(0);
    const { listRecordingIds, readRecording } = require("./files.ts");
    const ids = listRecordingIds(root);
    expect(ids).toHaveLength(1);
    const recording = readRecording(ids[0], false, root);
    expect(recording.events.at(-1)).toMatchObject({ type: "end", reason: "server stopped", reasonCode: "serverStopped" });
    expect(recording.events[0].data).toBe("last prompt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
