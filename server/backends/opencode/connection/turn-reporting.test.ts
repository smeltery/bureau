import { expect, test } from "bun:test";
import { OpenCodeTurnAccounting } from "./turn-accounting.ts";
import { providerFailure } from "./failures.ts";
import { applyOpenCodeEvent } from "../transport-events.ts";
import { parseAllowedEvent } from "../parse.ts";
import type { NormalizedEvent } from "../../types.ts";

function fixture() {
  const events: NormalizedEvent[] = [];
  const accounting = new OpenCodeTurnAccounting();
  const context = {
    sink: (event: NormalizedEvent) => events.push(event),
    settle: (event: NormalizedEvent) => events.push(event.kind === "turn_completed" ? { ...event, ...accounting.totals("s") } : event),
    abortRequested: false,
    autoApprove: false,
    replyPermission: async () => {},
    setPendingPermission: () => {},
    assistantMessages: new Set<string>(),
    textByPart: new Map<string, string>(),
    reasoningByPart: new Map<string, string>(),
    tools: new Map(),
    seenPermissions: new Set<string>(),
    accounting,
    onContext: () => {},
  };
  const wire = (type: string, properties: object) => {
    const event = parseAllowedEvent(JSON.stringify({ type, properties }));
    expect(event).not.toBeNull();
    applyOpenCodeEvent(event!, context);
  };
  const step = (id: string, messageID: string, cost: number) =>
    wire("message.part.updated", { part: { sessionID: "s", id, messageID, type: "step-finish", cost, tokens: { input: 10, output: 2, cache: { read: 3, write: 1 } } } });
  return { events, context, wire, step };
}

test("compaction stays in the turn, hides summaries and bills each step once", () => {
  const f = fixture();
  f.step("first", "answer", 1);
  f.wire("session.error", { sessionID: "s", error: { name: "ContextOverflowError" } });
  expect(f.events.some((event) => event.kind === "turn_completed")).toBe(false);
  f.wire("message.updated", { info: { sessionID: "s", id: "summary", role: "assistant", summary: true } });
  f.wire("message.part.updated", { part: { sessionID: "s", id: "summary-text", messageID: "summary", type: "text", text: "internal summary" } });
  f.step("summary-step", "summary", 2);
  f.wire("message.updated", { info: { sessionID: "s", id: "answer", role: "assistant" } });
  f.wire("message.part.updated", { part: { sessionID: "s", id: "answer-text", messageID: "answer", type: "text", text: "actual answer" } });
  f.step("final", "answer", 3);
  f.step("final", "answer", 3);
  f.wire("session.idle", { sessionID: "s" });
  expect(f.events.filter((event) => event.kind === "assistant_text")).toEqual([{ kind: "assistant_text", text: "actual answer" }]);
  expect(f.events.at(-1)).toMatchObject({
    kind: "turn_completed",
    status: "completed",
    cost: 6,
    costMode: "turn",
    usage: { inputTokens: 30, outputTokens: 6, cacheReadInputTokens: 9, cacheCreationInputTokens: 3 },
  });
});

test("overflow without a resumed answer fails; Stop can interrupt compaction", () => {
  for (const abortRequested of [false, true]) {
    const f = fixture();
    f.wire("session.error", { sessionID: "s", error: { name: "ContextOverflowError" } });
    f.context.abortRequested = abortRequested;
    f.wire("session.idle", { sessionID: "s" });
    expect(f.events.at(-1)).toMatchObject({ kind: "turn_completed", status: abortRequested ? "interrupted" : "failed" });
  }
});

test("provider retries explain the cause without echoing provider secrets", () => {
  const f = fixture();
  f.wire("session.status", { sessionID: "s", status: { type: "retry", attempt: 2, message: "rate limit; secret-token" } });
  expect(f.events[0]).toMatchObject({ kind: "system_text", text: expect.stringContaining("retry 2") });
  expect(JSON.stringify(f.events)).not.toContain("secret-token");
  expect(providerFailure({ statusCode: 503 })).toContain("503");
  expect(providerFailure({ message: "ECONNREFUSED secret-token" })).toContain("connect");
});
