import { isClaudeCodeAuthenticated, isClaudeCodeInstalled } from "../backends/claude-install-check.ts";
import { getCodexLoginCommands, isCodexAuthenticated } from "../backends/codex/native-bin.ts";
import { readEnvFile } from "../persistence.ts";
import { managedUserEnvExists, readManagedUserEnv } from "../persistence/managed-env.ts";
import { getUserById } from "../users.ts";
import * as AgentManager from "../agent-manager.ts";
import type { ProviderAccountProvider, ProviderAccountWire, ProviderAccountsWire, ProviderAuthVia } from "../../shared/provider-accounts.ts";

const STATUS_TTL_MS = 15_000;

type CacheEntry = { checkedAt: number; accounts: ProviderAccountWire[] };

const statusCache = new Map<string, CacheEntry>();

/** Effective env for a signed-in user: process → office → user envFile → managed user env. */
export function buildProviderProbeEnv(userId: string): { [key: string]: string | undefined } {
  const merged: { [key: string]: string | undefined } = { ...process.env };
  const officeEnvFile = AgentManager.getOfficeSettings().envFile;
  if (officeEnvFile) {
    try {
      Object.assign(merged, readEnvFile(officeEnvFile));
    } catch {
      // Probe path: broken office env must not 500 the Connections pane.
    }
  }
  const userEnvFile = getUserById(userId)?.envFile ?? null;
  if (userEnvFile) {
    try {
      Object.assign(merged, readEnvFile(userEnvFile));
    } catch {
      // Same: surface status from process.env rather than failing the list.
    }
  }
  // Connections writes land in the managed user env file; merge last so a
  // freshly saved API key is visible even before envFile is linked.
  if (managedUserEnvExists(userId)) {
    try {
      Object.assign(merged, readManagedUserEnv(userId));
    } catch {
      // ignore
    }
  }
  return merged;
}

export function listProviderAccounts(userId: string, refresh = false): ProviderAccountsWire {
  const cached = statusCache.get(userId);
  if (!refresh && cached && Date.now() - cached.checkedAt < STATUS_TTL_MS) {
    return { accounts: cached.accounts };
  }
  const env = buildProviderProbeEnv(userId);
  const accounts = [probeClaude(env), probeCodex(env)];
  statusCache.set(userId, { checkedAt: Date.now(), accounts });
  return { accounts };
}

export function invalidateProviderAccountCache(userId: string): void {
  statusCache.delete(userId);
}

function probeClaude(env: { [key: string]: string | undefined }): ProviderAccountWire {
  const hasApiKey = Boolean(env.ANTHROPIC_API_KEY?.trim());
  const cliInstalled = isClaudeCodeInstalled();
  const connected = isClaudeCodeAuthenticated(env);
  const authVia = authViaOf(hasApiKey, connected && !hasApiKey);
  return {
    provider: "claude",
    accountStatus: connected ? "connected" : "not_connected",
    accountLabel: connected ? (hasApiKey ? "API key" : "CLI credentials") : undefined,
    authVia,
    hasApiKey,
    cliInstalled,
    hostHints: claudeHostHints(cliInstalled),
  };
}

function probeCodex(env: { [key: string]: string | undefined }): ProviderAccountWire {
  const hasApiKey = Boolean(env.OPENAI_API_KEY?.trim());
  const connected = isCodexAuthenticated(env);
  const authVia = authViaOf(hasApiKey, connected && !hasApiKey);
  return {
    provider: "codex",
    accountStatus: connected ? "connected" : "not_connected",
    accountLabel: connected ? (hasApiKey ? "API key" : "CLI credentials") : undefined,
    authVia,
    hasApiKey,
    hostHints: getCodexLoginCommands(),
  };
}

function authViaOf(hasApiKey: boolean, hasCli: boolean): ProviderAuthVia {
  if (hasApiKey) return "api_key";
  if (hasCli) return "cli";
  return "none";
}

function claudeHostHints(cliInstalled: boolean): string[] {
  if (cliInstalled) return ["claude"];
  return ["curl -fsSL https://claude.ai/install.sh | bash"];
}

export function providerLabel(provider: ProviderAccountProvider): string {
  return provider === "claude" ? "Claude" : "Codex";
}
