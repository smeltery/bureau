/** Wire shapes for Settings → Connections provider status (no secrets). */

export type ProviderAccountProvider = "claude" | "codex";

export type ProviderAccountStatus = "connected" | "not_connected" | "unavailable";

export type ProviderAuthVia = "api_key" | "cli" | "none";

export interface ProviderAccountWire {
  provider: ProviderAccountProvider;
  accountStatus: ProviderAccountStatus;
  /** Short human label such as "API key" or "CLI credentials" — never a secret. */
  accountLabel?: string;
  authVia: ProviderAuthVia;
  /** True when the effective env has the provider API key set (value never returned). */
  hasApiKey: boolean;
  /** Claude: whether the human `claude` CLI is on PATH. */
  cliInstalled?: boolean;
  /** Host-side login hints (CLI commands), never secrets. */
  hostHints: string[];
  error?: string;
}

export interface ProviderAccountsWire {
  accounts: ProviderAccountWire[];
}

/** Partial update of provider API keys into the caller's managed user env. */
export interface ProviderKeysUpdateReq {
  /** Set ANTHROPIC_API_KEY; omit to leave unchanged; empty string clears. */
  anthropicApiKey?: string;
  /** Set OPENAI_API_KEY; omit to leave unchanged; empty string clears. */
  openaiApiKey?: string;
}

export interface ProviderKeysUpdateRes {
  accounts: ProviderAccountWire[];
  /** Keys that were written or cleared — names only. */
  updated: string[];
}
