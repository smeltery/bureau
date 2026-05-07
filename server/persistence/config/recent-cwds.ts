import { readFileSync, existsSync } from "fs";
import { atomicWriteFileSync, RECENT_CWDS_FILE } from "../paths.ts";

const MAX_RECENT_CWDS = 20;

export function loadRecentCwds(): string[] {
  try {
    if (!existsSync(RECENT_CWDS_FILE)) return [];
    return JSON.parse(readFileSync(RECENT_CWDS_FILE, "utf-8")) as string[];
  } catch {
    return [];
  }
}

export function saveRecentCwd(cwd: string) {
  try {
    const recent = loadRecentCwds().filter((c) => c !== cwd);
    recent.unshift(cwd);
    atomicWriteFileSync(RECENT_CWDS_FILE, JSON.stringify(recent.slice(0, MAX_RECENT_CWDS), null, 2));
  } catch (err) {
    console.error("Failed to save recent cwd:", err);
  }
}
