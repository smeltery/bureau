import { readFileSync } from "fs";
import { join } from "path";

import { atomicWriteFileSync, BUREAU_DIR } from "./persistence.ts";

const SKILL_USAGE_FILE = join(BUREAU_DIR, "skill-usage.json");

type SkillUsageStore = Record<string, Record<string, number>>;

const nullProto = <T>(): Record<string, T> => Object.create(null) as Record<string, T>;

let store: SkillUsageStore | null = null;

function sanitize(raw: unknown): SkillUsageStore {
  const out = nullProto<Record<string, number>>();
  if (raw === null || typeof raw !== "object") return out;
  for (const [userId, counts] of Object.entries(raw)) {
    if (counts === null || typeof counts !== "object") continue;
    const clean = nullProto<number>();
    let hasCounts = false;
    for (const [name, count] of Object.entries(counts)) {
      if (typeof count === "number" && Number.isInteger(count) && count > 0) {
        clean[name] = count;
        hasCounts = true;
      }
    }
    if (hasCounts) out[userId] = clean;
  }
  return out;
}

function load(): SkillUsageStore {
  if (store) return store;
  try {
    store = sanitize(JSON.parse(readFileSync(SKILL_USAGE_FILE, "utf-8")));
  } catch {
    store = nullProto<Record<string, number>>();
  }
  return store;
}

export function recordSkillUse(userId: string | null | undefined, name: string): void {
  if (!userId || !name) return;
  const usage = load();
  const counts = (usage[userId] ??= nullProto<number>());
  counts[name] = (counts[name] ?? 0) + 1;
  try {
    atomicWriteFileSync(SKILL_USAGE_FILE, JSON.stringify(usage, null, 2));
  } catch (err) {
    console.error("[skill-usage] failed to persist counts:", err);
  }
}

export function getSkillUseCounts(userId: string | null | undefined): Record<string, number> {
  const out = nullProto<number>();
  if (!userId) return out;
  const counts = load()[userId];
  if (counts) {
    for (const [name, count] of Object.entries(counts)) out[name] = count;
  }
  return out;
}

export function _testResetSkillUsage(): void {
  store = null;
}
