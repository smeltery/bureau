import { expect, test } from "bun:test";
import { handleCodexSessionStderr } from "../session-process-events.ts";

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
