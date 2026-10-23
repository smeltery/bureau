import { createClaudeAccountProcess } from "./claude-process.ts";
import { query, type Options, type SDKUserMessage } from "@anthropic-ai/claude-agent-sdk";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unlinkSync } from "node:fs";
import { CLAUDE_NATIVE_BIN } from "../../agents/session/claude-native.ts";
import { AccountError, accountLoginUrl, type AccountClient, type AccountEnvironment } from "./types.ts";

interface ClaudeAccountControls {
  accountInfo(): Promise<unknown>;
  claudeAuthenticate(firstParty: boolean): Promise<{ manualUrl?: unknown }>;
  claudeOAuthCallback(code: string, state: string): Promise<unknown>;
  claudeOAuthWaitForCompletion(): Promise<unknown>;
  close(): void;
}
const unsupported = () => new AccountError("This Claude version does not support browser sign-in. Use the terminal login command.", 422);
export function parseClaudeCallback(value: string, expectedState: string): { code: string; state: string } {
  const input = value.trim();
  let code = input,
    state = expectedState;
  if (/^https:\/\//i.test(input)) {
    const url = new URL(input);
    code = url.searchParams.get("code") ?? "";
    state = url.searchParams.get("state") ?? expectedState;
  } else if (input.includes("#")) {
    const separator = input.lastIndexOf("#");
    code = input.slice(0, separator);
    state = input.slice(separator + 1);
  }
  if (!code || code.length > 4096 || /[\x00-\x20\x7f]/.test(code) || !state || state !== expectedState)
    throw new AccountError("The sign-in code does not match this login. Copy the code from its browser tab.");
  return { code, state };
}
export class ClaudeAccountClient implements AccountClient {
  private process = createClaudeAccountProcess();
  private abort = new AbortController();
  private controls: ClaudeAccountControls | null = null;
  private state: string | null = null;
  constructor(
    private readonly env: AccountEnvironment,
    private readonly create: (input: { prompt: AsyncIterable<SDKUserMessage>; options: Options }) => unknown = query,
  ) {}
  async start() {
    const signal = this.abort.signal;
    signal.throwIfAborted();
    const prompt: AsyncIterable<SDKUserMessage> = {
      [Symbol.asyncIterator]: () => ({
        next: async () => {
          if (!signal.aborted) await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
          return { done: true, value: undefined };
        },
      }),
    };
    const raw = this.create({
      prompt,
      options: {
        spawnClaudeCodeProcess: this.process.spawn,
        env: this.env,
        cwd: tmpdir(),
        pathToClaudeCodeExecutable: CLAUDE_NATIVE_BIN,
        abortController: this.abort,
        tools: [],
        mcpServers: {},
        agents: {},
        plugins: [],
        settingSources: [],
        strictMcpConfig: true,
        settings: { disableClaudeAiConnectors: true },
        stderr: () => {},
      },
    }) as Partial<ClaudeAccountControls>;
    if (["accountInfo", "claudeAuthenticate", "claudeOAuthCallback", "claudeOAuthWaitForCompletion", "close"].some((method) => typeof raw[method as keyof ClaudeAccountControls] !== "function")) {
      raw.close?.();
      await this.process.close();
      throw unsupported();
    }
    this.controls = raw as ClaudeAccountControls;
    if (signal.aborted) {
      await this.close();
      signal.throwIfAborted();
    }
    await this.controls.accountInfo();
  }
  async read() {
    const value = await this.required().accountInfo();
    if (!value || typeof value !== "object") return { connected: false };
    const account = value as Record<string, unknown>;
    const connected =
      (account.apiProvider === undefined || account.apiProvider === "firstParty") &&
      (typeof account.tokenSource === "string" ? account.tokenSource !== "none" : account.apiProvider === "firstParty" && typeof account.email === "string" && !!account.email);
    return { connected, label: connected && typeof account.email === "string" ? account.email : undefined };
  }
  async login(_method: "browser" | "device") {
    const result = await this.required().claudeAuthenticate(true);
    const url = accountLoginUrl(result.manualUrl, "claude");
    this.state = new URL(url).searchParams.get("state");
    if (!this.state) throw new AccountError("Claude did not return a sign-in state.", 502);
    return { url };
  }
  async callback(value: string) {
    if (!this.state) throw new AccountError("Start a new sign-in first.", 409);
    const parsed = parseClaudeCallback(value, this.state);
    try {
      await this.required().claudeOAuthCallback(parsed.code, parsed.state);
    } catch {
      throw new AccountError("Claude rejected that code. Use the code from this sign-in or start again.", 422);
    }
  }
  async complete() {
    await this.required().claudeOAuthWaitForCompletion();
  }
  async logout() {
    const directory = this.env.CLAUDE_CONFIG_DIR;
    if (!directory) throw new AccountError("No Claude credential directory was selected.");
    try {
      unlinkSync(join(directory, ".credentials.json"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  terminate() {
    this.process.terminate();
  }
  async close() {
    this.abort.abort();
    try {
      this.controls?.close();
    } finally {
      this.controls = null;
      await this.process.close();
    }
  }
  private required() {
    if (!this.controls) throw unsupported();
    return this.controls;
  }
}
