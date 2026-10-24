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
        return { async *[Symbol.asyncIterator]() { yield { type: "result", subtype: "success", result: "A short topic" }; }, interrupt: async () => {}, close() {} };
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
      tools: [], settingSources: [], mcpServers: {}, agents: {}, strictMcpConfig: true,
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

test("background streams close on completion, failure and timeout", () => {
  const result = Bun.spawnSync(
    [
      process.execPath,
      "--eval",
      `
      import { expect, mock } from "bun:test";
      let mode = "success";
      const queries = [];
      mock.module("@anthropic-ai/claude-agent-sdk", () => ({ query(request) {
        const q = { closed: false, close() { this.closed = true; }, async *[Symbol.asyncIterator]() {
          if (mode === "stall") await new Promise(() => {});
          if (mode === "failure") throw new Error("Provider failed");
          yield { type: "result", subtype: "success", result: "Summary" };
        } };
        queries.push(q);
        expect(request.options).toMatchObject({ cwd: "/tmp", settingSources: [], thinking: { type: "disabled" } });
        expect(request.options.timeoutMs).toBeUndefined();
        return q;
      } }));
      const { runClaudeOneShot } = await import("./server/backends/claude-raw-session.ts");
      const options = { cwd: "/private/project", settingSources: ["project"], timeoutMs: 10 };
      expect(await runClaudeOneShot("Conversation", options)).toEqual({ subtype: "success", result: "Summary" });
      expect(queries.at(-1).closed).toBe(true);
      for (mode of ["failure", "stall"]) {
        await expect(runClaudeOneShot("Conversation", options)).rejects.toThrow(mode === "failure" ? "Provider failed" : "timed out");
        expect(queries.at(-1).closed).toBe(true);
      }
    `,
    ],
    { env: process.env, stdout: "pipe", stderr: "pipe" },
  );
  expect(result.exitCode, result.stderr.toString()).toBe(0);
});
