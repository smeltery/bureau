import { expect, test } from "bun:test";
import { displayLogContent, logContent } from "../../../../shared/i18n/log-message.ts";
import { handleCodexServerRequest } from "../session-requests.ts";
import { SessionPrefixRules } from "../prefix-rules.ts";
import { LOGIN_INSTRUCTIONS } from "../config.ts";
import type { NormalizedEvent } from "../../types.ts";
import { codexSubprocessExitEvent, handleCodexSessionStderr } from "../session-process-events.ts";

test("coalesced startup notices do not hide sandbox failures", () => {
  const messages: string[] = [];
  handleCodexSessionStderr("Config is ignored until the project is trusted, but skills still load\nbwrap: Creating new namespace failed: Operation not permitted\n", new Set(), (text) =>
    messages.push(text),
  );
  expect(messages).toEqual(["[codex stderr] bwrap: Creating new namespace failed: Operation not permitted"]);
});

test("namespace requirements remain visible for container troubleshooting", () => {
  const messages: string[] = [];
  handleCodexSessionStderr("bubblewrap needs access to create user namespaces\npermission denied", new Set(), (text) => messages.push(text));
  expect(messages).toEqual(["[codex stderr] bubblewrap needs access to create user namespaces\npermission denied"]);
  handleCodexSessionStderr("Config is ignored until the project is trusted, but skills still load", new Set(), (text) => messages.push(text));
  expect(messages).toHaveLength(1);
});

test("mid-turn exits retain their canonical reason and translate code and signal labels", () => {
  for (const [code, signal] of [
    [7, "SIGTERM"],
    [null, null],
  ] as const) {
    const event = codexSubprocessExitEvent({ code, signal, turnInFlight: true });
    if (event.kind !== "turn_completed") throw new Error("Expected completion");
    expect(event.error).toBe(`codex subprocess exited${code !== null ? ` (code ${code})` : ""}${signal ? ` (signal ${signal})` : ""} mid-turn`);
    const entry = { ...logContent(event.errorMessage!), kind: "error" as const };
    for (const language of ["es", "ca", "zh"] as const) {
      expect(displayLogContent(entry, language)).not.toBe(event.error);
      if (signal) expect(displayLogContent(entry, language)).toContain(signal);
    }
  }
});

test("token refresh failures translate the login guidance without changing the protocol rejection", async () => {
  const events: NormalizedEvent[] = [];
  await expect(
    handleCodexServerRequest(
      { id: 1, method: "account/chatgptAuthTokens/refresh" },
      { threadId: null, pendingApprovals: new Map(), prefixRules: new SessionPrefixRules(), enqueue: (event) => events.push(event) },
    ),
  ).rejects.toThrow(`No token store: ${LOGIN_INSTRUCTIONS}`);
  const event = events[0];
  if (event.kind !== "error") throw new Error("Expected error");
  expect(event.message).toBe(`Codex requested a ChatGPT auth token refresh, but Bureau has no token store. ${LOGIN_INSTRUCTIONS}`);
  const entry = { ...logContent(event.errorMessage!), kind: "error" as const };
  for (const language of ["es", "ca", "zh"] as const) {
    expect(displayLogContent(entry, language)).not.toBe(event.message);
    expect(displayLogContent(entry, language)).toContain("`~/.bureau/bin/codex login --device-auth`");
  }
});
