import { expect, spyOn, test } from "bun:test";
import type { ServerWebSocket } from "bun";
import type { ServerMessage, UserRecord } from "../../shared/types.ts";
import { membersChatStore } from "./index.ts";
import { sendInitialPayload } from "../ws-initial-payload.ts";
import { bindWsUser, clearWsUser } from "../user-sockets.ts";
import { disposeOfficeSocket, officeSocket } from "../ws/outbox/sockets.ts";

test("initial replay includes only the recipient's unread summary before its completion fence", async () => {
  const summary = spyOn(membersChatStore, "summary").mockImplementation((userId) => ({ userId, unread: userId === "alice" ? 2 : 7, readPointer: userId + "-read", latestId: "latest" }));
  try {
    for (const userId of ["alice", "bob"]) {
      const frames: ServerMessage[] = [];
      let completed!: () => void;
      const done = new Promise<void>((resolve) => {
        completed = resolve;
      });
      const raw = {
        send: (text: string) => {
          const frame = JSON.parse(text);
          frames.push(frame);
          if (frame.type === "log_replay_complete") completed();
          return 1;
        },
        getBufferedAmount: () => 0,
        terminate() {},
      } as unknown as ServerWebSocket<unknown>;
      const socket = officeSocket(raw);
      bindWsUser(socket, { id: userId, name: userId, role: "member", allowedRooms: [], hidden: [], order: [] } as unknown as UserRecord);
      try {
        sendInitialPayload(socket);
        await done;
        const full = frames.find((frame) => frame.type === "full_state");
        expect(full?.type === "full_state" && full.membersChat).toEqual({ userId, unread: userId === "alice" ? 2 : 7, readPointer: userId + "-read", latestId: "latest" });
        expect(frames.findIndex((frame) => frame.type === "full_state")).toBeLessThan(frames.findIndex((frame) => frame.type === "log_replay_complete"));
      } finally {
        clearWsUser(socket);
        disposeOfficeSocket(raw);
      }
    }
  } finally {
    summary.mockRestore();
  }
});
