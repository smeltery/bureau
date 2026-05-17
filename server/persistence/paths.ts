import { join } from "path";
import { homedir } from "os";
import { mkdirSync, renameSync, writeFileSync } from "fs";

export const DEFAULT_BUREAU_DIR = join(homedir(), ".bureau");
export const BUREAU_DIR = process.env.BUREAU_HOME?.trim() || DEFAULT_BUREAU_DIR;
export const LOGS_DIR = join(BUREAU_DIR, "logs");
export const AGENTS_FILE = join(BUREAU_DIR, "agents.json");
export const OFFICE_PROMPT_FILE = join(BUREAU_DIR, "office-prompt.md");
export const OFFICE_CONFIG_FILE = join(BUREAU_DIR, "office-config.json");
export const TASKS_FILE = join(BUREAU_DIR, "tasks.json");
export const AGENT_HISTORY_FILE = join(BUREAU_DIR, "agent-history.json");
export const MANIFEST_FILE = join(BUREAU_DIR, "agents-summary.json");
export const RECENT_CWDS_FILE = join(BUREAU_DIR, "recent-cwds.json");

// Cronjobs live under their own subtree mirroring agent logs (one extra level
// of nesting: <jobId>/<runId>/...). See server/cronjobs and the design doc.
export const CRONJOBS_DIR = join(BUREAU_DIR, "cronjobs");
export const CRONJOBS_FILE = join(CRONJOBS_DIR, "cronjobs.json");
export const CRONJOB_HISTORY_FILE = join(CRONJOBS_DIR, "cronjob-history.json");
export const CRONJOBS_PROMPT_FILE = join(CRONJOBS_DIR, "cronjobs-prompt.md");

// Ensure directories exist
try {
  mkdirSync(BUREAU_DIR, { recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });
  mkdirSync(CRONJOBS_DIR, { recursive: true });
} catch {}

// Atomic file write: write to a sibling .tmp file then rename. Renames are
// atomic on the same filesystem, so a concurrent reader (notably the backup
// tarball) sees either the previous contents or the new contents, never a
// half-written file. JSONL appends are line-tolerant and skip this.
export function atomicWriteFileSync(path: string, data: string | Buffer) {
  const tmp = path + ".tmp";
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}
