import { resolve } from "node:path";
import type { AgentBackendType } from "../../shared/types.ts";
import type { ProviderAccountProvider } from "../../shared/provider-accounts.ts";
import { DEFAULT_MEMBER_SHARE } from "../../shared/member-usage/share.ts";
import { getUserById, getUserByName } from "../users.ts";
import { officeConfig } from "../agents/state.ts";
import { buildSessionEnv } from "../agents/session/session-env.ts";
import type { ManagedAgent } from "../agents/state-types.ts";
import { BUREAU_CODEX_HOME } from "../backends/codex/native-bin.ts";
import { createOfficeUsageReader, FRESH_MS, WEEK_MS, type OfficeUsageReader } from "./office-usage.ts";
import { readEnvFile } from "../persistence.ts";

const DAY_MS = WEEK_MS / 7;

export type BillingAccount = { provider: ProviderAccountProvider; dir: string } | null;

export type Admission = { kind: "admitted" } | { kind: "exempt" } | { kind: "refused"; retryAtMs: number };

export class UsageCapError extends Error {
  constructor(readonly retryAtMs: number) {
    super("usage_cap");
    this.name = "UsageCapError";
  }
}

export function evaluateLine(usedPercent: number, resetsAtMs: number, now: number, share: number): { allowed: boolean; linePercent: number; retryAtMs: number } {
  const weekStart = resetsAtMs - WEEK_MS;
  const line = (day: number) => (share * day) / 7;
  const today = Math.min(7, Math.max(1, Math.floor((now - weekStart) / DAY_MS) + 1));
  let retryAtMs = resetsAtMs;
  for (let day = today + 1; day <= 7; day++) {
    if (line(day) > usedPercent) {
      retryAtMs = weekStart + (day - 1) * DAY_MS;
      break;
    }
  }
  return { allowed: usedPercent < line(today), linePercent: line(today), retryAtMs };
}

export function directInputCapped(username: string | undefined): boolean {
  if (!username) return true;
  return getUserByName(username)?.role !== "owner";
}

export function managerCapped(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return getUserById(userId)?.role === "member";
}

export function billingAccountFor(agentType: AgentBackendType, env: Record<string, string | undefined> | undefined): BillingAccount {
  if (agentType === "claude") return { provider: "claude", dir: resolve(env?.CLAUDE_CONFIG_DIR || `${process.env.HOME}/.claude`) };
  if (agentType === "codex") return { provider: "codex", dir: resolve(env?.CODEX_HOME || BUREAU_CODEX_HOME) };
  return null;
}

export function usageCapText(err: Pick<UsageCapError, "retryAtMs">, now = Date.now()): string {
  const minutes = Math.max(1, Math.ceil((err.retryAtMs - now) / 60_000));
  const when = minutes < 90 ? `${minutes} minute${minutes === 1 ? "" : "s"}` : `${Math.ceil(minutes / 60)} hours`;
  return `Member usage is ahead of the office pace. Try again in about ${when}.`;
}

export interface MemberUsageCap {
  isEnabled(): boolean;
  share(): number;
  admit(billing: BillingAccount): Promise<Admission>;
  peek(billing: BillingAccount): Admission | null;
  status(): Promise<OfficeUsageStatusWire[]>;
  invalidate(provider: ProviderAccountProvider): void;
  close(): void;
}

export type OfficeUsageStatusWire =
  | { provider: ProviderAccountProvider; state: "no_limit" | "failed" }
  | { provider: ProviderAccountProvider; state: "weekly"; usedPercent: number; linePercent: number };

export function officeUsageTarget(provider: ProviderAccountProvider): { env: Record<string, string | undefined> } {
  const env: Record<string, string | undefined> = { ...process.env };
  if (officeConfig.envFile) Object.assign(env, readEnvFile(officeConfig.envFile));
  if (provider === "codex" && !env.CODEX_HOME) env.CODEX_HOME = BUREAU_CODEX_HOME;
  return { env };
}

export function createMemberUsageCap(deps: { reader: OfficeUsageReader; now?: () => number }): MemberUsageCap {
  const now = deps.now ?? Date.now;
  const recent = new Map<string, { admission: Admission; at: number }>();

  function officeAccount(billing: BillingAccount): { kind: "office"; key: string; provider: ProviderAccountProvider } | { kind: "other" } | { kind: "error" } {
    if (!billing) return { kind: "other" };
    let env: Record<string, string | undefined>;
    try {
      env = officeUsageTarget(billing.provider).env;
    } catch {
      return { kind: "error" };
    }
    const target = billing.provider === "codex" ? (env.CODEX_HOME ?? BUREAU_CODEX_HOME) : (env.CLAUDE_CONFIG_DIR ?? `${process.env.HOME}/.claude`);
    if (resolve(billing.dir) !== resolve(target)) return { kind: "other" };
    return { kind: "office", key: `${billing.provider}:${resolve(target)}`, provider: billing.provider };
  }

  async function read(provider: ProviderAccountProvider): Promise<Admission> {
    const outcome = await deps.reader.read(provider);
    if (outcome.kind === "no_limit") return { kind: "exempt" };
    if (outcome.kind !== "weekly") return { kind: "admitted" };
    const line = evaluateLine(outcome.usedPercent, outcome.resetsAtMs, now(), officeConfig.memberUsageShare ?? DEFAULT_MEMBER_SHARE);
    return line.allowed ? { kind: "admitted" } : { kind: "refused", retryAtMs: line.retryAtMs };
  }

  return {
    isEnabled: () => officeConfig.memberUsageCap === true,
    share: () => officeConfig.memberUsageShare ?? DEFAULT_MEMBER_SHARE,
    async admit(billing) {
      if (officeConfig.memberUsageCap !== true) return { kind: "admitted" };
      const account = officeAccount(billing);
      if (account.kind === "error") return { kind: "admitted" };
      if (account.kind === "other") return { kind: "exempt" };
      const admission = await read(account.provider);
      recent.set(account.key, { admission, at: now() });
      return admission;
    },
    peek(billing) {
      if (officeConfig.memberUsageCap !== true) return { kind: "admitted" };
      const account = officeAccount(billing);
      if (account.kind === "error") return { kind: "admitted" };
      if (account.kind === "other") return { kind: "exempt" };
      const last = recent.get(account.key);
      if (!last || now() - last.at > FRESH_MS) return null;
      if (last.admission.kind === "refused" && now() >= last.admission.retryAtMs) return null;
      return last.admission;
    },
    async status() {
      const rows = await Promise.all(
        (["claude", "codex"] as const).map(async (provider): Promise<OfficeUsageStatusWire | null> => {
          const outcome = await deps.reader.read(provider);
          if (outcome.kind === "signed_out") return null;
          if (outcome.kind === "no_limit") return { provider, state: "no_limit" };
          if (outcome.kind === "failed") return { provider, state: "failed" };
          const line = evaluateLine(outcome.usedPercent, outcome.resetsAtMs, now(), officeConfig.memberUsageShare ?? DEFAULT_MEMBER_SHARE);
          return { provider, state: "weekly", usedPercent: outcome.usedPercent, linePercent: line.linePercent };
        }),
      );
      return rows.filter((row): row is OfficeUsageStatusWire => row !== null);
    },
    invalidate(provider) {
      deps.reader.invalidate(provider);
      for (const key of recent.keys()) if (key.startsWith(`${provider}:`)) recent.delete(key);
    },
    close() {
      deps.reader.close();
      recent.clear();
    },
  };
}

let shared: MemberUsageCap | null = null;

export function memberUsageCap(): MemberUsageCap {
  shared ??= createMemberUsageCap({ reader: createOfficeUsageReader({ officeTarget: officeUsageTarget }) });
  return shared;
}

export function setMemberUsageCapForTests(next: MemberUsageCap | null): MemberUsageCap | null {
  const previous = shared;
  shared = next;
  return previous;
}

export async function admitMemberTurn(managed: ManagedAgent, username: string | null, humanInput: boolean): Promise<void> {
  const capped = humanInput ? directInputCapped(username ?? undefined) : managerCapped(managed.info.userId);
  if (!capped) return;
  const env = buildSessionEnv(managed);
  const admission = await memberUsageCap().admit(billingAccountFor(managed.info.agentType, env));
  if (admission.kind === "refused") throw new UsageCapError(admission.retryAtMs);
}
