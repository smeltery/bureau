import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_AGENT_CAPABILITIES, type AgentInfo } from "../../../shared/types.ts";
import { createTopicGenerator } from "../topics/generation.ts";
import { captureMetadataProvider } from "./provider.ts";

test("a sign-out during generation preserves the label without delaying the next attempt", async () => {
  const home = mkdtempSync(join(tmpdir(), "bureau-topic-account-"));
  const auth = join(home, "auth.json");
  const info: AgentInfo = {
    id: "topic-account",
    name: "Test",
    desk: 0,
    room: 0,
    cwd: "/tmp",
    agentType: "codex",
    modelFamily: "test",
    permissionMode: "default",
    outfit: { hat: "none", color: "#000000", hair: "#000000", hairStyle: "short", skin: "#000000", beard: "none", accessory: null },
    capabilities: DEFAULT_AGENT_CAPABILITIES,
    state: "idle",
    topic: null,
    topicStale: false,
    customInstructions: null,
  };
  let calls = 0;
  let reply = "401 Unauthorized";
  let signOut = true;
  const env = { CODEX_HOME: home };
  const provider = captureMetadataProvider(info, "session", {
    environment: () => ({ env }),
    backend: () => ({
      capabilities: DEFAULT_AGENT_CAPABILITIES,
      getModelOptions: () => [],
      detectAuthError: (text) => /401|authentication/i.test(text),
      async oneShotPrompt() {
        calls++;
        if (signOut) rmSync(auth, { force: true });
        return reply;
      },
    }),
  })!;
  const state = { topic: "Earlier topic", generating: false };
  const generator = createTopicGenerator<typeof state>({
    generating: (target, value) => {
      target.generating = value;
    },
    apply: (target, label) => {
      target.topic = label;
    },
    onError() {},
  });
  const request = {
    ...provider,
    topic: null,
    isCurrent: () => true,
    entries: [{ id: "entry", agentId: info.id, timestamp: 1, kind: "user_message" as const, content: "Fix the deployment" }],
  };
  try {
    writeFileSync(auth, "{}");
    await generator.generate(state, request);
    expect(state).toEqual({ topic: "Earlier topic", generating: false });
    // The captured account, not a subsequently selected account, owns this request.
    env.CODEX_HOME = "/another-account";
    signOut = false;
    writeFileSync(auth, "{}");
    reply = "Fix authentication errors";
    await generator.generate(state, request);
    expect(calls).toBe(2);
    expect(state).toEqual({ topic: reply, generating: false });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});
