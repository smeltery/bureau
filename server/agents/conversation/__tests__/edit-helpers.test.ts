import { describe, expect, test } from "bun:test";

import type { LogEntry } from "../../../../shared/types.ts";
import type { NormalizedMessage } from "../../../backends/types.ts";
import { findSdkUserMessageIndex, userMessageMissingBecauseTurnWasStopped } from "../edit-helpers.ts";

function user(id: string, content: string): LogEntry {
  return {
    id,
    agentId: "agent-1",
    timestamp: Date.now(),
    kind: "user_message",
    content,
  };
}

function backendUser(uuid: string, text: string): NormalizedMessage {
  return { uuid, role: "user", text };
}

describe("edit helpers", () => {
  test("matches normalized backend user messages by occurrence", () => {
    const messages = [backendUser("u1", "repeat"), { uuid: "a1", role: "assistant" as const, text: "ok" }, backendUser("u2", "repeat")];

    expect(findSdkUserMessageIndex(messages, "repeat", 0)).toBe(0);
    expect(findSdkUserMessageIndex(messages, "repeat", 1)).toBe(2);
    expect(findSdkUserMessageIndex(messages, "repeat", 2)).toBe(-1);
  });

  test("recognizes the latest log message missing after Stop", () => {
    const entries = [user("first", "first"), user("second", "second")];
    const messages = [backendUser("u1", "first"), { uuid: "a1", role: "assistant" as const, text: "reply" }];

    expect(userMessageMissingBecauseTurnWasStopped(messages, entries, "second")).toBe(true);
  });

  test("does not treat an older or ambiguous missing message as stopped-before-send", () => {
    expect(userMessageMissingBecauseTurnWasStopped([backendUser("u1", "first")], [user("first", "first"), user("second", "second")], "first")).toBe(false);
    expect(userMessageMissingBecauseTurnWasStopped([backendUser("u1", "first"), backendUser("u2", "something else")], [user("first", "first"), user("second", "second")], "second")).toBe(false);
  });
});
