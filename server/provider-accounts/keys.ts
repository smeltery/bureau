import { ManagedEnvValidationError, managedUserEnvPath, readManagedUserEnv, writeManagedUserEnv } from "../persistence/managed-env.ts";
import { invalidateProviderAccountCache, listProviderAccounts } from "./status.ts";
import type { ProviderKeysUpdateReq, ProviderKeysUpdateRes } from "../../shared/provider-accounts.ts";

const ANTHROPIC = "ANTHROPIC_API_KEY";
const OPENAI = "OPENAI_API_KEY";

export type SetProviderKeysResult = { ok: true; value: ProviderKeysUpdateRes; envPath: string } | { ok: false; status: 400; error: string };

/**
 * Merge provider API keys into the user's managed env file.
 * Omitted fields are left alone; empty string clears the key.
 * Never returns secret values.
 */
export function setProviderKeys(userId: string, body: ProviderKeysUpdateReq): SetProviderKeysResult {
  if (body.anthropicApiKey === undefined && body.openaiApiKey === undefined) {
    return { ok: false, status: 400, error: "provide anthropicApiKey and/or openaiApiKey" };
  }

  const current = readManagedUserEnv(userId);
  const next = { ...current };
  const updated: string[] = [];

  if (body.anthropicApiKey !== undefined) {
    applyKey(next, ANTHROPIC, body.anthropicApiKey, updated);
  }
  if (body.openaiApiKey !== undefined) {
    applyKey(next, OPENAI, body.openaiApiKey, updated);
  }

  if (updated.length === 0) {
    invalidateProviderAccountCache(userId);
    return { ok: true, value: { accounts: listProviderAccounts(userId, true).accounts, updated }, envPath: managedUserEnvPath(userId) };
  }

  try {
    writeManagedUserEnv(userId, next);
  } catch (caught) {
    if (caught instanceof ManagedEnvValidationError) {
      return { ok: false, status: 400, error: caught.message };
    }
    throw caught;
  }

  invalidateProviderAccountCache(userId);
  return {
    ok: true,
    value: { accounts: listProviderAccounts(userId, true).accounts, updated },
    envPath: managedUserEnvPath(userId),
  };
}

function applyKey(values: Record<string, string>, key: string, raw: string, updated: string[]): void {
  const trimmed = raw.trim();
  if (!trimmed) {
    if (key in values) {
      delete values[key];
      updated.push(key);
    }
    return;
  }
  if (values[key] === trimmed) return;
  values[key] = trimmed;
  updated.push(key);
}
