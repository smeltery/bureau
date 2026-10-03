import { query } from "@anthropic-ai/claude-agent-sdk";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import type { ProviderAccountProvider } from "../../shared/provider-accounts.ts";
import { CLAUDE_NATIVE_BIN } from "../agents/session/claude-native.ts";
import { JsonRpcLiteClient } from "../backends/codex/client.ts";
import type { GetAccountResponse } from "../backends/codex/_generated/v2/GetAccountResponse.ts";
import type { GetAccountRateLimitsResponse } from "../backends/codex/_generated/v2/GetAccountRateLimitsResponse.ts";
import type { RateLimitSnapshot } from "../backends/codex/_generated/v2/RateLimitSnapshot.ts";
import { CODEX_LEGACY_LIMIT_KEY, CODEX_PREFERRED_LIMIT_ID } from "../backends/codex/session-rate-limits.ts";

export const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
export const FRESH_MS = 60_000;
const FALLBACK_MS = 60 * 60_000;
const PROBE_TIMEOUT_MS = 20_000;
const CODEX_WEEK_MINUTES = 10_080;
const RESET_SLACK_MS = 60 * 60_000;

export type OfficeWeeklyOutcome =
  | { kind: "weekly"; usedPercent: number; resetsAtMs: number; observedAtMs: number }
  | { kind: "no_limit"; observedAtMs: number }
  | { kind: "signed_out" }
  | { kind: "failed" };

type GoodOutcome = Extract<OfficeWeeklyOutcome, { observedAtMs: number }>;

export type ProbeResult = { kind: "weekly"; usedPercent: number; resetsAtMs: number } | { kind: "no_limit" } | { kind: "signed_out" } | { kind: "failed" };

export interface OfficeUsageProbe {
  read(): Promise<ProbeResult>;
  close(): void;
}

function validPercent(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

export function parseClaudeWeekly(raw: unknown): ProbeResult {
  if (!raw || typeof raw !== "object") return { kind: "failed" };
  const resp = raw as { rate_limits_available?: unknown; rate_limits?: unknown };
  if (resp.rate_limits_available === false) return { kind: "no_limit" };
  if (resp.rate_limits_available !== true) return { kind: "failed" };
  const week = (resp.rate_limits as Record<string, unknown> | undefined)?.seven_day as { utilization?: unknown; resets_at?: unknown } | undefined;
  if (!week || !validPercent(week.utilization)) return { kind: "failed" };
  const resetsAtMs = typeof week.resets_at === "string" ? Date.parse(week.resets_at) : NaN;
  if (!Number.isFinite(resetsAtMs)) return { kind: "failed" };
  return { kind: "weekly", usedPercent: week.utilization, resetsAtMs };
}

export function parseCodexWeekly(account: GetAccountResponse["account"], limits: GetAccountRateLimitsResponse | null): ProbeResult {
  if (!account) return { kind: "signed_out" };
  if (account.type === "apiKey" || account.type === "amazonBedrock") return { kind: "no_limit" };
  if (!limits) return { kind: "failed" };
  const snapshot: RateLimitSnapshot | undefined = limits.rateLimitsByLimitId?.[CODEX_PREFERRED_LIMIT_ID] ?? limits.rateLimitsByLimitId?.[CODEX_LEGACY_LIMIT_KEY] ?? limits.rateLimits;
  if (!snapshot) return { kind: "failed" };
  for (const win of [snapshot.primary, snapshot.secondary]) {
    if (!win || win.windowDurationMins !== CODEX_WEEK_MINUTES) continue;
    if (!validPercent(win.usedPercent)) return { kind: "failed" };
    if (typeof win.resetsAt !== "number" || !Number.isFinite(win.resetsAt)) return { kind: "failed" };
    return { kind: "weekly", usedPercent: win.usedPercent, resetsAtMs: win.resetsAt * 1000 };
  }
  return { kind: "failed" };
}

type UsageQuery = {
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: () => Promise<unknown>;
  close?: () => void;
};

export function claudeOfficeProbe(env: Record<string, string | undefined>): OfficeUsageProbe {
  const abortController = new AbortController();
  async function* input(): AsyncGenerator<never> {
    await new Promise<void>((resolve) => abortController.signal.addEventListener("abort", () => resolve()));
    if (!abortController.signal.aborted) yield undefined as never;
  }
  const q = query({
    prompt: input(),
    options: {
      cwd: tmpdir(),
      env,
      settingSources: [],
      pathToClaudeCodeExecutable: CLAUDE_NATIVE_BIN,
      abortController,
    },
  }) as unknown as UsageQuery;
  return {
    async read() {
      const usage = q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET;
      if (typeof usage !== "function") return { kind: "failed" };
      return parseClaudeWeekly(await usage.call(q));
    },
    close() {
      abortController.abort();
      try {
        q.close?.();
      } catch {}
    },
  };
}

export function codexOfficeProbe(env: Record<string, string | undefined>): OfficeUsageProbe {
  const client = new JsonRpcLiteClient({ env });
  let started: Promise<void> | null = null;
  return {
    async read() {
      started ??= (async () => {
        await client.start();
        await client.initialize({
          clientInfo: { name: "bureau", version: "1", title: null },
          capabilities: { experimentalApi: true, requestAttestation: false, optOutNotificationMethods: null },
        });
      })();
      await started;
      const account = await client.request<GetAccountResponse>("account/read", { refreshToken: false });
      if (!account.account || account.account.type !== "chatgpt") return parseCodexWeekly(account.account, null);
      const limits = await client.request<GetAccountRateLimitsResponse>("account/rateLimits/read", undefined);
      return parseCodexWeekly(account.account, limits);
    },
    close() {
      void client.close().catch(() => {});
    },
  };
}

export interface OfficeUsageReaderDeps {
  officeTarget: (provider: ProviderAccountProvider) => { env: Record<string, string | undefined> };
  createProbe?: (provider: ProviderAccountProvider, env: Record<string, string | undefined>) => OfficeUsageProbe;
  now?: () => number;
}

export interface OfficeUsageReader {
  read(provider: ProviderAccountProvider): Promise<OfficeWeeklyOutcome>;
  invalidate(provider: ProviderAccountProvider): void;
  close(): void;
}

export function createOfficeUsageReader(deps: OfficeUsageReaderDeps): OfficeUsageReader {
  const now = deps.now ?? Date.now;
  const createProbe = deps.createProbe ?? ((provider, env) => (provider === "claude" ? claudeOfficeProbe(env) : codexOfficeProbe(env)));
  type Slot = {
    key: string;
    cached: OfficeWeeklyOutcome | null;
    lastGood: GoodOutcome | null;
    inFlight: Promise<OfficeWeeklyOutcome> | null;
    probe: OfficeUsageProbe | null;
  };
  const slots = new Map<ProviderAccountProvider, Slot>();

  function targetKey(provider: ProviderAccountProvider): { key: string; env: Record<string, string | undefined> } | null {
    try {
      const target = deps.officeTarget(provider);
      const entries = Object.entries(target.env)
        .filter(([, value]) => value !== undefined)
        .sort(([a], [b]) => a.localeCompare(b));
      return { key: createHash("sha256").update(JSON.stringify(entries)).digest("hex"), env: target.env };
    } catch {
      return null;
    }
  }

  function settle(result: ProbeResult, at: number): OfficeWeeklyOutcome {
    if (result.kind === "no_limit") return { kind: "no_limit", observedAtMs: at };
    if (result.kind !== "weekly") return result;
    if (result.resetsAtMs <= at || result.resetsAtMs > at + WEEK_MS + RESET_SLACK_MS) return { kind: "failed" };
    return { ...result, observedAtMs: at };
  }

  function usable(outcome: OfficeWeeklyOutcome | null, at: number): boolean {
    return !!outcome && "observedAtMs" in outcome && at - outcome.observedAtMs <= FRESH_MS && (outcome.kind !== "weekly" || outcome.resetsAtMs > at);
  }

  function fallback(slot: Slot, at: number): GoodOutcome | null {
    const last = slot.lastGood;
    if (!last || at - last.observedAtMs >= FALLBACK_MS) return null;
    if (last.kind === "weekly" && last.resetsAtMs <= at) return null;
    return last;
  }

  function drop(slot: Slot): void {
    slot.probe?.close();
    slot.probe = null;
  }

  return {
    async read(provider) {
      const target = targetKey(provider);
      if (!target) return { kind: "failed" };
      let slot = slots.get(provider);
      if (!slot || slot.key !== target.key) {
        if (slot) drop(slot);
        slot = { key: target.key, cached: null, lastGood: null, inFlight: null, probe: null };
        slots.set(provider, slot);
      }
      const at = now();
      if (usable(slot.cached, at)) return slot.cached!;
      slot.inFlight ??= (async () => {
        let result: ProbeResult;
        try {
          slot!.probe ??= createProbe(provider, target.env);
          result = await Promise.race([slot!.probe.read(), new Promise<ProbeResult>((resolve) => setTimeout(() => resolve({ kind: "failed" }), PROBE_TIMEOUT_MS))]);
        } catch {
          result = { kind: "failed" };
        }
        if (result.kind === "failed") drop(slot!);
        const outcome = settle(result, now());
        slot!.cached = outcome.kind === "failed" ? null : outcome;
        if (outcome.kind === "weekly" || outcome.kind === "no_limit") slot!.lastGood = outcome;
        return outcome.kind === "failed" ? (fallback(slot!, now()) ?? outcome) : outcome;
      })().finally(() => {
        if (slot) slot.inFlight = null;
      });
      return slot.inFlight;
    },
    invalidate(provider) {
      const slot = slots.get(provider);
      if (!slot) return;
      drop(slot);
      slots.delete(provider);
    },
    close() {
      for (const slot of slots.values()) drop(slot);
      slots.clear();
    },
  };
}
