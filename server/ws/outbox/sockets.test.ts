import * as AgentManager from "../../agent-manager.ts";
import type { AgentInfo, LogEntry } from "../../../shared/types.ts";
import { sendInitialPayload } from "../../ws-initial-payload.ts";
import { expect, spyOn, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import { disposeOfficeSocket, drainOfficeSocket, officeSocket, replayOfficeFrames } from "./sockets.ts";

test("an access projection change drops a pending replay and reconnects", async () => {
  let terminated = 0;
  const sent: string[] = [];
  const raw = {
    send: (value: string) => {
      sent.push(value);
      return 1;
    },
    getBufferedAmount: () => 256 * 1024,
    terminate: () => {
      terminated++;
    },
  } as unknown as ServerWebSocket<unknown>;
  const socket = officeSocket(raw);
  expect(officeSocket(raw)).toBe(socket);
  replayOfficeFrames(socket, ["private history"][Symbol.iterator]());
  socket.send("private live event");
  replayOfficeFrames(socket, ["new projection"][Symbol.iterator]());
  drainOfficeSocket(raw);
  await new Promise((resolve) => setTimeout(resolve, 10));
  expect(terminated).toBe(1);
  expect(sent).toEqual([]);
  disposeOfficeSocket(raw);
});

test("the socket facade preserves native Bun receivers and ordered replay", async () => {
  let resolveDone!: () => void;
  let rejectDone!: (error: Error) => void;
  const done = new Promise<void>((resolve, reject) => {
    resolveDone = resolve;
    rejectDone = reject;
  });
  const server = Bun.serve<{ marker: string }>({
    port: 0,
    hostname: "127.0.0.1",
    fetch(req, server) {
      if (server.upgrade(req, { data: { marker: "office" } })) return;
      return new Response(null, { status: 400 });
    },
    websocket: {
      open(raw) {
        const socket = officeSocket(raw);
        expect(socket.data.marker).toBe("office");
        expect(socket.getBufferedAmount()).toBe(0);
        replayOfficeFrames(
          socket,
          (function* () {
            for (let i = 0; i < 32; i++) yield JSON.stringify({ i, text: "x".repeat(64 * 1024) });
            yield "fence";
          })(),
        );
        socket.send("live");
      },
      message() {},
      drain: drainOfficeSocket,
      close: disposeOfficeSocket,
    },
  });
  const client = new WebSocket(`ws://127.0.0.1:${server.port}`);
  const seen: string[] = [];
  client.onmessage = ({ data }) => {
    seen.push(String(data));
    if (data === "live") resolveDone();
  };
  client.onerror = () => rejectDone(new Error("websocket failed"));
  const timeout = setTimeout(() => rejectDone(new Error("replay did not finish")), 3000);
  try {
    await done;
    expect(seen.length).toBe(34);
    expect(seen.slice(0, 32).map((frame) => JSON.parse(frame).i)).toEqual(Array.from({ length: 32 }, (_, i) => i));
    expect(seen.slice(-2)).toEqual(["fence", "live"]);
  } finally {
    clearTimeout(timeout);
    client.close();
    await server.stop(true);
  }
});

test("initial payload captures the history boundary before live entries arrive", async () => {
  const old: LogEntry = { id: "old", agentId: "replay-agent", timestamp: 1, kind: "text", content: "history" };
  const live: LogEntry = { ...old, id: "live", content: "new" };
  const logs = [old];
  const spies = [
    spyOn(AgentManager, "getAllAgents").mockReturnValue([{ id: old.agentId, room: 0 } as AgentInfo]),
    spyOn(AgentManager, "getAgentLogs").mockReturnValue(logs),
    spyOn(AgentManager, "getAgentCommands").mockReturnValue({ commands: [], skills: [] }),
  ];
  const sent: Array<{ type: string; entry?: LogEntry }> = [];
  let buffered = 256 * 1024;
  let finish!: () => void;
  const done = new Promise<void>((resolve) => {
    finish = resolve;
  });
  const raw = {
    send: (value: string) => {
      const frame = JSON.parse(value);
      sent.push(frame);
      if (frame.entry?.id === "live") finish();
      return 1;
    },
    getBufferedAmount: () => buffered,
    terminate() {},
  } as unknown as ServerWebSocket<unknown>;
  const socket = officeSocket(raw);
  try {
    sendInitialPayload(socket);
    logs.push(live);
    socket.send(JSON.stringify({ type: "log_entry", entry: live }));
    buffered = 0;
    drainOfficeSocket(raw);
    await done;
    expect(sent.filter((frame) => frame.type === "log_entry").map((frame) => frame.entry?.id)).toEqual(["old", "live"]);
    expect(sent.findIndex((frame) => frame.type === "log_replay_complete")).toBeLessThan(sent.findIndex((frame) => frame.entry?.id === "live"));
  } finally {
    disposeOfficeSocket(raw);
    for (const spy of spies.reverse()) spy.mockRestore();
  }
});
