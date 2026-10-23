import type { ProviderAccountProvider } from "../../../shared/provider-accounts.ts";
export type AccountScope = "office" | "personal";
export type AccountEnvironment = Record<string, string | undefined>;
export interface AccountTarget {
  provider: ProviderAccountProvider;
  scope: AccountScope;
  userId: string;
  directory: string;
  key: string;
  env: AccountEnvironment;
  managed: boolean;
  available: boolean;
  apiKeyPresent: boolean;
  activePersonal?: boolean;
}
export interface AccountStatus {
  connected: boolean;
  label?: string;
}
export interface AccountLogin {
  url: string;
  loginId?: string;
  userCode?: string;
}
export interface AccountClient {
  start(): Promise<void>;
  read(): Promise<AccountStatus>;
  login(method: "browser" | "device"): Promise<AccountLogin>;
  complete(): Promise<void>;
  callback?(code: string): Promise<void>;
  logout(): Promise<void>;
  close(): Promise<void>;
  terminate?(): void;
}
export class AccountError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
export function accountLoginUrl(value: unknown, provider: ProviderAccountProvider): string {
  if (typeof value !== "string" || value.length > 16384) throw new AccountError("The provider returned an invalid sign-in address.", 502);
  const url = new URL(value);
  const hosts = provider === "codex" ? ["auth.openai.com", "chatgpt.com", "auth.chatgpt.com"] : ["claude.ai", "console.anthropic.com", "platform.claude.com"];
  if (url.protocol !== "https:" || !hosts.includes(url.hostname) || url.username || url.password || (url.port && url.port !== "443"))
    throw new AccountError("The provider returned an invalid sign-in address.", 502);
  return url.href;
}
