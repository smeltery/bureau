import { describe, expect, test } from "bun:test";
import type { LogEntry } from "../../../shared/types.ts";
import { pinnedHumanMessageId, senderIsHuman, type VerticalRect } from "./pinned-human-message.ts";

function message(id: string, metadata?: Record<string, unknown>): LogEntry {
  return {
    id,
    agentId: "agent-1",
    timestamp: 1,
    kind: "user_message",
    content: id,
    metadata,
  };
}

const above: VerticalRect = { top: -30, bottom: -10 };
const viewport: VerticalRect = { top: 0, bottom: 500 };

describe("senderIsHuman", () => {
  test("treats plain composer metadata as human", () => {
    expect(senderIsHuman({ username: "Nil" })).toBe(true);
    expect(senderIsHuman(undefined)).toBe(true);
  });

  test("rejects agent, app, cron, and API-token senders", () => {
    expect(senderIsHuman({ sender_agent_name: "Worker" })).toBe(false);
    expect(senderIsHuman({ sender_app_name: "watcher" })).toBe(false);
    expect(senderIsHuman({ sender_cronjob_name: "nightly" })).toBe(false);
    expect(senderIsHuman({ username: "Nil", device: 'API token "phone" (pat-1)' })).toBe(false);
  });
});

describe("pinnedHumanMessageId", () => {
  test("skips newer agent messages and pins the older human message", () => {
    const logs = [message("human", { username: "Nil" }), message("agent-1", { sender_agent_name: "Worker 1" }), message("agent-2", { sender_agent_name: "Worker 2" })];
    expect(pinnedHumanMessageId(logs, () => above, viewport)).toBe("human");
  });

  test("returns null without crashing when no human message exists", () => {
    const logs = [message("agent", { sender_agent_name: "Worker" }), message("app", { sender_app_name: "watcher" })];
    expect(pinnedHumanMessageId(logs, () => above, viewport)).toBeNull();
  });

  test("does not pin a message sent through a personal API token", () => {
    const logs = [
      message("token", {
        username: "Nil",
        device: 'API token "phone" (pat-1)',
      }),
    ];
    expect(pinnedHumanMessageId(logs, () => above, viewport)).toBeNull();
  });

  test("clears the pin when a human message is visible in the viewport", () => {
    const logs = [message("human", { username: "Nil" })];
    const visible: VerticalRect = { top: 10, bottom: 40 };
    expect(pinnedHumanMessageId(logs, () => visible, viewport)).toBeNull();
  });
});
