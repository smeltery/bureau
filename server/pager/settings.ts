import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";
import type { PagerSettingsWire } from "../../shared/types.ts";
import { atomicWriteFileSync } from "../persistence/paths.ts";
import { PAGER_DIR } from "./store.ts";

// Discord user ids and repeat intervals are ordinary settings and ride along
// in backups. Webhook URLs are credentials (anyone holding one can post into
// the member's channel), so they live in their own owner-only file that
// backups omit.
export const PAGER_SETTINGS_FILE = join(PAGER_DIR, "settings.json");
export const PAGER_WEBHOOKS_FILE = join(PAGER_DIR, "discord-webhooks.json");
export const DEFAULT_REPEAT_MINUTES = 5;
export const MAX_REPEAT_MINUTES = 24 * 60;

type StoredSettings = Record<string, { discordUserId?: string; repeatMinutes?: number | null }>;

let settings: StoredSettings | null = null;
let webhooks: Record<string, string> | null = null;

function readJson<T extends object>(path: string): T {
  try {
    const parsed = existsSync(path) ? JSON.parse(readFileSync(path, "utf-8")) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as T) : ({} as T);
  } catch {
    return {} as T;
  }
}

function loadSettings(): StoredSettings {
  return (settings ??= readJson<StoredSettings>(PAGER_SETTINGS_FILE));
}

function loadWebhooks(): Record<string, string> {
  return (webhooks ??= readJson<Record<string, string>>(PAGER_WEBHOOKS_FILE));
}

function write(path: string, value: object): void {
  mkdirSync(PAGER_DIR, { recursive: true });
  atomicWriteFileSync(path, JSON.stringify(value, null, 2));
}

function writeSecret(path: string, value: object): void {
  mkdirSync(PAGER_DIR, { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
}

export function isDiscordWebhookUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return url.protocol === "https:" && /^(?:(?:ptb|canary)\.)?discord(?:app)?\.com$/.test(url.hostname) && /^\/api\/(?:v\d+\/)?webhooks\/\d+\/[\w-]+\/?$/.test(url.pathname);
  } catch {
    return false;
  }
}

export function getPagerSettings(userId: string): PagerSettingsWire {
  const stored = loadSettings()[userId] ?? {};
  return {
    discordUserId: stored.discordUserId ?? "",
    repeatMinutes: stored.repeatMinutes === undefined ? DEFAULT_REPEAT_MINUTES : stored.repeatMinutes,
    webhookConfigured: !!loadWebhooks()[userId],
  };
}

export function getDiscordWebhook(userId: string): string | null {
  return loadWebhooks()[userId] ?? null;
}

export interface PagerSettingsChanges {
  discordUserId?: unknown;
  repeatMinutes?: unknown;
  // A string sets the URL, null removes it, absent leaves it alone.
  webhookUrl?: unknown;
}

export function updatePagerSettings(userId: string, changes: PagerSettingsChanges): { ok: true; settings: PagerSettingsWire } | { ok: false; error: string } {
  const current = { ...(loadSettings()[userId] ?? {}) };
  if (changes.discordUserId !== undefined) {
    const id = typeof changes.discordUserId === "string" ? changes.discordUserId.trim() : null;
    if (id === null || (id !== "" && !/^\d{5,25}$/.test(id))) return { ok: false, error: "discordUserId must be a numeric Discord user id" };
    current.discordUserId = id;
  }
  if (changes.repeatMinutes !== undefined) {
    const minutes = changes.repeatMinutes;
    if (minutes !== null && !(Number.isInteger(minutes) && (minutes as number) >= 1 && (minutes as number) <= MAX_REPEAT_MINUTES)) {
      return { ok: false, error: `repeatMinutes must be null or a whole number from 1 to ${MAX_REPEAT_MINUTES}` };
    }
    current.repeatMinutes = minutes as number | null;
  }
  if (changes.webhookUrl !== undefined) {
    const url = typeof changes.webhookUrl === "string" ? changes.webhookUrl.trim() : changes.webhookUrl;
    if (url !== null && (typeof url !== "string" || !isDiscordWebhookUrl(url))) return { ok: false, error: "webhookUrl must be a Discord webhook URL" };
    const next = { ...loadWebhooks() };
    if (url === null) delete next[userId];
    else next[userId] = url;
    writeSecret(PAGER_WEBHOOKS_FILE, next);
    webhooks = next;
  }
  const nextSettings = { ...loadSettings(), [userId]: current };
  write(PAGER_SETTINGS_FILE, nextSettings);
  settings = nextSettings;
  return { ok: true, settings: getPagerSettings(userId) };
}

export function _testResetPagerSettings(): void {
  settings = null;
  webhooks = null;
}
