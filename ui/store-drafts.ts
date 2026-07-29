import { getBrowserStorage, type BrowserStorage } from "./browser-storage.ts";

const DRAFT_KEY_PREFIX = "bureau:draft:";
const FIELD_SEPARATOR = ":";

export type DraftStorage = BrowserStorage;

function browserStorage(): DraftStorage | null {
  return getBrowserStorage();
}

export function normalizeDraftUser(username: string | null | undefined): string | null {
  const trimmed = username?.trim();
  if (!trimmed) return null;
  return trimmed.toLocaleLowerCase();
}

function draftPrefix(username: string): string {
  return `${DRAFT_KEY_PREFIX}${encodeURIComponent(username)}${FIELD_SEPARATOR}`;
}

function draftKey(username: string, agentId: string): string {
  return `${draftPrefix(username)}${encodeURIComponent(agentId)}`;
}

function agentIdFromDraftKey(prefix: string, key: string): string | null {
  if (!key.startsWith(prefix)) return null;
  const encoded = key.slice(prefix.length);
  if (!encoded) return null;
  try {
    return decodeURIComponent(encoded);
  } catch {
    return null;
  }
}

export function readDraftsForUser(username: string, liveAgentIds: Set<string>, storage: DraftStorage | null = browserStorage()): Map<string, string> {
  const drafts = new Map<string, string>();
  if (!storage) return drafts;

  const prefix = draftPrefix(username);
  try {
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key) continue;
      const agentId = agentIdFromDraftKey(prefix, key);
      if (!agentId || !liveAgentIds.has(agentId)) continue;
      const value = storage.getItem(key);
      if (value) drafts.set(agentId, value);
    }
  } catch {
    return new Map();
  }

  return drafts;
}

export function writeDraftForUser(username: string, agentId: string, text: string, storage: DraftStorage | null = browserStorage()) {
  if (!storage) return;
  try {
    const key = draftKey(username, agentId);
    if (text) storage.setItem(key, text);
    else storage.removeItem(key);
  } catch {}
}

export function pruneDraftsForUser(username: string, liveAgentIds: Set<string>, storage: DraftStorage | null = browserStorage()) {
  if (!storage) return;
  const prefix = draftPrefix(username);
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < storage.length; i += 1) {
      const key = storage.key(i);
      if (!key) continue;
      const agentId = agentIdFromDraftKey(prefix, key);
      if (agentId && !liveAgentIds.has(agentId)) keysToRemove.push(key);
    }
    keysToRemove.forEach((key) => storage.removeItem(key));
  } catch {}
}
