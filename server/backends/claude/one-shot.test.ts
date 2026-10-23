import { expect, test } from "bun:test";

test("background prompts disable tools and MCP while interactive sessions retain their options", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
    import { expect, mock } from "bun:test";
    const requests = [];
    mock.module("@anthropic-ai/claude-agent-sdk", () => ({
      query(request) {
        requests.push(request);
        return { async *[Symbol.asyncIterator]() { yield { type: "result", subtype: "success", result: "A short topic" }; }, interrupt: async () => {} };
      },
    }));
    const { runClaudeOneShot, RawClaudeSession } = await import("./server/backends/claude-raw-session.ts");
    const options = {
      model: "test-model", cwd: "/tmp", env: { TEST_FLAG: "kept" },
      tools: ["Bash"], settingSources: ["user", "project"], strictMcpConfig: false,
      mcpServers: { test: { command: "must-not-start" } },
      agents: { worker: { description: "worker", prompt: "work", mcpServers: [{ test: { command: "must-not-start" } }] } },
      settings: { autoMemoryEnabled: false, disableClaudeAiConnectors: false, env: { DISABLE_TELEMETRY: "1" } },
    };
    expect(await runClaudeOneShot("Label this", options)).toEqual({ subtype: "success", result: "A short topic" });
    const sent = requests[0];
    expect(sent.prompt).toBe("Label this");
    expect(sent.options).toMatchObject({
      model: "test-model", cwd: "/tmp", env: { TEST_FLAG: "kept" },
      tools: [], settingSources: ["user", "project"], mcpServers: {}, agents: {}, strictMcpConfig: true,
      settings: { autoMemoryEnabled: false, disableClaudeAiConnectors: true, env: { DISABLE_TELEMETRY: "1" } },
    });
    expect(options.strictMcpConfig).toBe(false);
    expect(options.settings.disableClaudeAiConnectors).toBe(false);
    const session = new RawClaudeSession(options);
    expect(requests[1].options).toBe(options);
    session.close();
  `,
    ],
    { env: process.env, stdout: "pipe", stderr: "pipe" },
  );
  expect(result.exitCode, result.stderr.toString()).toBe(0);
});
