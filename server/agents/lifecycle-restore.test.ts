import { describe, expect, test } from "bun:test";

import { buildRestoredAgentInfo } from "./lifecycle-restore.ts";

describe("buildRestoredAgentInfo", () => {
  test("hydrates persisted queued messages into the wire agent", () => {
    const info = buildRestoredAgentInfo(
      {
        id: "agent-1",
        name: "Restored",
        userId: null,
        desk: 0,
        cwd: process.cwd(),
        outfit: {
          hat: "none",
          color: "#000000",
          hair: "#000000",
          hairStyle: "short",
          skin: "#000000",
          beard: "none",
          accessory: null,
        },
        permissionMode: "default",
        modelFamily: "sonnet",
        agentType: "claude",
        lastSessionId: "session-1",
        topic: null,
        customInstructions: null,
        queue: [{ id: "msg-1", sender: { kind: "user", username: "Nil" }, text: "survived restart", queuedAt: 1 }],
      },
      0,
    );

    expect(info.queue?.map((m) => m.text)).toEqual(["survived restart"]);
  });
});
