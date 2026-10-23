import { tmpdir } from "node:os";
import { JsonRpcLiteClient } from "../../backends/codex/client.ts";
import type { GetAccountResponse } from "../../backends/codex/_generated/v2/GetAccountResponse.ts";
import type { LoginAccountResponse } from "../../backends/codex/_generated/v2/LoginAccountResponse.ts";
import type { AccountLoginCompletedNotification } from "../../backends/codex/_generated/v2/AccountLoginCompletedNotification.ts";
import { AccountError, accountLoginUrl, type AccountClient, type AccountEnvironment } from "./types.ts";

type Transport = Pick<JsonRpcLiteClient, "start" | "initialize" | "request" | "close" | "onNotification" | "onExit" | "onClose" | "forceClose">;
export class CodexAccountClient implements AccountClient {
  private exited: Promise<void> = Promise.resolve();
  private started = false;
  private loginId: string | null = null;
  private events: AccountLoginCompletedNotification[] = [];
  private completion: Promise<void>;
  private resolve!: () => void;
  private reject!: (error: Error) => void;
  private dispose: (() => void)[] = [];
  constructor(private readonly transport: Transport) {
    this.completion = new Promise((resolve, reject) => {
      this.resolve = resolve;
      this.reject = reject;
    });
    void this.completion.catch(() => {});
  }
  async start() {
    this.exited = new Promise((resolve) => {
      this.dispose.push(this.transport.onClose(resolve));
    });

    this.dispose.push(
      this.transport.onNotification((notification) => {
        if (notification.method !== "account/login/completed") return;
        const result = notification.params as AccountLoginCompletedNotification;
        if (this.events.length < 10) this.events.push(result);
        this.settle();
      }),
      this.transport.onExit(() => this.reject(new AccountError("Provider sign-in process stopped.", 502))),
    );
    this.transport.start();
    this.started = true;
    await this.transport.initialize({ clientInfo: { name: "bureau", title: "Bureau", version: "1" }, capabilities: { experimentalApi: true, requestAttestation: false } });
  }
  async read() {
    const result = await this.transport.request<GetAccountResponse>("account/read", { refreshToken: true });
    return { connected: result.account?.type === "chatgpt", label: result.account?.type === "chatgpt" ? (result.account.email ?? "ChatGPT") : undefined };
  }
  async login(method: "browser" | "device") {
    const result = await this.transport.request<LoginAccountResponse>(
      "account/login/start",
      method === "device" ? { type: "chatgptDeviceCode" } : { type: "chatgpt", useHostedLoginSuccessPage: true },
    );
    if (result.type !== "chatgpt" && result.type !== "chatgptDeviceCode") throw new AccountError("Codex did not start a browser sign-in.", 502);
    this.loginId = result.loginId;
    this.settle();
    return {
      loginId: result.loginId,
      url: accountLoginUrl(result.type === "chatgpt" ? result.authUrl : result.verificationUrl, "codex"),
      ...(result.type === "chatgptDeviceCode" ? { userCode: result.userCode } : {}),
    };
  }
  private settle() {
    const result = this.events.find((event) => this.loginId !== null && event.loginId === this.loginId);
    if (!result) return;
    if (result.success) this.resolve();
    else this.reject(new AccountError("Codex sign-in did not complete. Start a new sign-in and try again.", 502));
  }
  complete() {
    return this.completion;
  }
  async logout() {
    await this.transport.request("account/logout", {});
  }
  terminate() {
    this.transport.forceClose();
  }
  async close() {
    this.reject(new AccountError("Sign-in cancelled.", 409));
    await this.transport.close();
    if (this.started) await this.exited;
    this.dispose.splice(0).forEach((dispose) => dispose());
  }
}
export function createCodexAccountClient(env: AccountEnvironment): AccountClient {
  return new CodexAccountClient(new JsonRpcLiteClient({ env, cwd: tmpdir() }));
}
