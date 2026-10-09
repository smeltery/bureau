import { claudeLoginCommand } from "../backends/claude/login-command.ts";
import { claudeSignInStatus } from "../backends/claude/sign-in-status.ts";
import { isClaudeCloudSelected, isClaudeCodeInstalled } from "../backends/claude-install-check.ts";
import { getCodexLoginCommands, isCodexAuthenticated } from "../backends/codex/native-bin.ts";
import { readEnvFile } from "../persistence.ts";
import { managedUserEnvExists, readManagedUserEnv } from "../persistence/managed-env.ts";
import { getUserById } from "../users.ts";
import * as AgentManager from "../agent-manager.ts";
import type { ProviderAccountProvider, ProviderAccountWire, ProviderAccountsWire, ProviderAuthVia } from "../../shared/provider-accounts.ts";
import { loginQueueOf } from "./sign-in-slot.ts";

const STATUS_TTL_MS = 15_000;
// Bound each Connections probe so a hung CLI/`which` never wedges the pane on
// "Checking…". ~15s is generous vs filesystem auth checks and matches the
// shared-status timeout used for interactive provider probes elsewhere.
export const ACCOUNT_STATUS_TIMEOUT_MS = 15_000;

type CacheEntry = { checkedAt: number; accounts: ProviderAccountWire[] };

const statusCache = new Map<string, CacheEntry>();

const PROBE_TIMED_OUT = Symbol("probeTimedOut");
type ProbedAccountWire = ProviderAccountWire & { [PROBE_TIMED_OUT]?: true };

type ScheduleAccountStatusTimeout = (onTimeout: () => void) => () => void;

class AccountStatusTimeout extends Error {
  // Keep message empty: probe errors surface Error.message on the wire.
}

export type ProviderProbeFns = {
  probeClaude: (env: { [key: string]: string | undefined }) => Promise<ProviderAccountWire>;
  probeCodex: (env: { [key: string]: string | undefined }) => Promise<ProviderAccountWire>;
  scheduleTimeout: ScheduleAccountStatusTimeout;
};

const defaultScheduleTimeout: ScheduleAccountStatusTimeout = (onTimeout) => {
  const timer = setTimeout(onTimeout, ACCOUNT_STATUS_TIMEOUT_MS);
  return () => clearTimeout(timer);
};

let probeFns: ProviderProbeFns = {
  probeClaude: probeClaude,
  probeCodex: async (env) => probeCodexSync(env),
  scheduleTimeout: defaultScheduleTimeout,
};

/** Test seam: swap probe runners / timeout scheduler; restores on dispose. */
export function setProviderProbeFnsForTests(next: Partial<ProviderProbeFns>): () => void {
  const prev = probeFns;
  probeFns = { ...prev, ...next };
  return () => {
    probeFns = prev;
  };
}

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

export async function listProviderAccounts(userId: string, refresh = false): Promise<ProviderAccountsWire> {
  const cached = statusCache.get(userId);
  if (!refresh && cached && Date.now() - cached.checkedAt < STATUS_TTL_MS) {
    return { accounts: withLiveQueues(cached.accounts) };
  }
  const env = buildProviderProbeEnv(userId);
  const probed = await Promise.all([runBoundedProbe("claude", () => probeFns.probeClaude(env), env), runBoundedProbe("codex", () => probeFns.probeCodex(env), env)]);
  const unavailable = probed.some((wire) => wire.accountStatus === "unavailable");
  const accounts = probed.map(stripProbeMarker);
  // Unavailable results must not stick in the TTL cache — next read starts fresh.
  if (!unavailable) {
    statusCache.set(userId, { checkedAt: Date.now(), accounts });
  } else {
    statusCache.delete(userId);
  }
  return { accounts: withLiveQueues(accounts) };
}

export function invalidateProviderAccountCache(userId: string): void {
  statusCache.delete(userId);
}

function withLiveQueues(accounts: ProviderAccountWire[]): ProviderAccountWire[] {
  return accounts.map((account) => {
    const queue = loginQueueOf(account.provider);
    if (!queue) {
      if (!account.loginQueue) return account;
      const { loginQueue: _dropped, ...rest } = account;
      return rest;
    }
    return { ...account, loginQueue: queue };
  });
}

async function runBoundedProbe(provider: ProviderAccountProvider, read: () => Promise<ProviderAccountWire>, env: Record<string, string | undefined>): Promise<ProbedAccountWire> {
  let cancelTimeout = () => {};
  try {
    const timedOut = new Promise<never>((_resolve, reject) => {
      cancelTimeout = probeFns.scheduleTimeout(() => reject(new AccountStatusTimeout()));
    });
    const wire = await Promise.race([read(), timedOut]);
    return wire;
  } catch (err) {
    const timedOut = err instanceof AccountStatusTimeout;
    const wire: ProbedAccountWire = {
      provider,
      accountStatus: "unavailable",
      authVia: "none",
      hasApiKey: false,
      hostHints: timedOut ? hostHintsFor(provider, env) : [],
      canOfferSignIn: timedOut,
      ...(timedOut ? {} : { error: err instanceof Error ? err.message || undefined : String(err) }),
    };
    if (timedOut) wire[PROBE_TIMED_OUT] = true;
    return wire;
  } finally {
    cancelTimeout();
  }
}

function stripProbeMarker(wire: ProbedAccountWire): ProviderAccountWire {
  const { [PROBE_TIMED_OUT]: _marker, ...rest } = wire;
  return rest;
}

function hostHintsFor(provider: ProviderAccountProvider, env: Record<string, string | undefined>): string[] {
  if (provider === "claude") return claudeHostHints(env);
  return getCodexLoginCommands();
}

async function probeClaude(env: { [key: string]: string | undefined }): Promise<ProviderAccountWire> {
  const hasApiKey = Boolean(env.ANTHROPIC_API_KEY?.trim());
  const cloudSelected = isClaudeCloudSelected(env);
  const cliInstalled = isClaudeCodeInstalled(env);
  const signIn = await claudeSignInStatus(env, true);
  const connected = signIn === "signed_in";
  const hasToken = Boolean(env.CLAUDE_CODE_OAUTH_TOKEN?.trim() || env.ANTHROPIC_AUTH_TOKEN?.trim());
  const authVia = authViaOf(hasApiKey, connected && !hasApiKey && !hasToken && !cloudSelected);
  return {
    provider: "claude",
    accountStatus: signIn === "unknown" ? "unavailable" : connected ? "connected" : "not_connected",
    accountLabel: connected ? (hasApiKey ? "API key" : cloudSelected ? claudeCloudLabel(env) : hasToken ? "Environment token" : "CLI credentials") : undefined,
    authVia,
    hasApiKey,
    cliInstalled,
    hostHints: claudeHostHints(env),
    canOfferSignIn: !connected,
  };
}

function claudeCloudLabel(env: { [key: string]: string | undefined }): string {
  if (isClaudeCloudSelected({ CLAUDE_CODE_USE_BEDROCK: env.CLAUDE_CODE_USE_BEDROCK })) return "Amazon Bedrock";
  if (isClaudeCloudSelected({ CLAUDE_CODE_USE_VERTEX: env.CLAUDE_CODE_USE_VERTEX })) return "Google Vertex AI";
  return "Cloud provider";
}

function probeCodexSync(env: { [key: string]: string | undefined }): ProviderAccountWire {
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
    canOfferSignIn: !connected,
  };
}

function authViaOf(hasApiKey: boolean, hasCli: boolean): ProviderAuthVia {
  if (hasApiKey) return "api_key";
  if (hasCli) return "cli";
  return "none";
}

function claudeHostHints(env?: Record<string, string | undefined>): string[] {
  const command = claudeLoginCommand(env);
  return command ? [command] : [];
}

export function providerLabel(provider: ProviderAccountProvider): string {
  return provider === "claude" ? "Claude" : "Codex";
}
