import { expect, test } from "bun:test";
import type { SDKMessage } from "@anthropic-ai/claude-agent-sdk";
import { ClaudeQuotaStop } from "./usage-limit.ts";

const resetSeconds = 1_900_000_000;
const quota = (status = "rejected", resetsAt: unknown = resetSeconds) => ({ type: "rate_limit_event", rate_limit_info: { status, resetsAt } }) as SDKMessage;
const refusal = (overrides = {}) => ({ type: "assistant", message: { model: "<synthetic>" }, error: "rate_limit", parent_tool_use_id: null, ...overrides }) as SDKMessage;
const result = { type: "result" } as SDKMessage;

test("Claude quota refusal and reset may arrive in either order", () => {
  for (const messages of [
    [quota(), refusal()],
    [refusal(), quota()],
  ]) {
    const tracker = new ClaudeQuotaStop();
    for (const message of messages) expect(tracker.observe(message)).toBeUndefined();
    expect(tracker.observe(result)).toBe(resetSeconds * 1000);
    expect(tracker.observe(result)).toBeUndefined();
    tracker.observe(refusal());
    expect(tracker.observe(result)).toBe(resetSeconds * 1000);
  }
});

test("plain rate limits, child refusals, and real model text cannot schedule a continuation", () => {
  for (const message of [refusal({ parent_tool_use_id: "child" }), refusal({ message: { model: "claude" } }), refusal({ error: "authentication_failed" })]) {
    const tracker = new ClaudeQuotaStop();
    tracker.observe(quota());
    tracker.observe(message);
    expect(tracker.observe(result)).toBeUndefined();
  }
  const tracker = new ClaudeQuotaStop();
  tracker.observe(refusal());
  expect(tracker.observe(result)).toBeUndefined();
  tracker.observe(quota("allowed"));
  tracker.observe(refusal());
  expect(tracker.observe(result)).toBeUndefined();
});

test("malformed and overflowing reset times are refused", () => {
  for (const value of [undefined, null, "tomorrow", NaN, Infinity, -1, 0, Number.MAX_VALUE]) {
    const tracker = new ClaudeQuotaStop();
    tracker.observe({ type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: value } } as SDKMessage);
    tracker.observe(refusal());
    expect(tracker.observe(result)).toBeUndefined();
  }
});

test("the Claude session attaches quota data to its normalized completion", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { expect, mock } from "bun:test";
    const sdk = await import("@anthropic-ai/claude-agent-sdk");
    mock.module("@anthropic-ai/claude-agent-sdk", () => ({ ...sdk, query() { return {
      async *[Symbol.asyncIterator]() {
        yield { type: "assistant", message: { model: "<synthetic>", content: [] }, error: "rate_limit", parent_tool_use_id: null };
        yield { type: "rate_limit_event", rate_limit_info: { status: "rejected", resetsAt: 1900000000 } };
        yield { type: "result", subtype: "success" };
      }, interrupt: async () => {}
    }; } }));
    const { claudeBackend } = await import("./server/backends/claude.ts");
    const session = claudeBackend.createSession({ agentId: "quota-test", cwd: "/tmp", env: {}, modelFamily: "sonnet", permissionMode: "default", systemPrompt: "test" });
    const events = [];
    for await (const event of session.stream()) events.push(event);
    expect(events.find(event => event.kind === "turn_completed")).toMatchObject({ status: "completed", usageLimitResetAt: 1900000000000 });
    session.close();
  `,
    ],
    { env: process.env, stdout: "pipe", stderr: "pipe" },
  );
  expect(result.exitCode, result.stderr.toString()).toBe(0);
});
