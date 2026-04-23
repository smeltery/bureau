import { join } from "path";
import { homedir } from "os";
import { mkdirSync } from "fs";

export const BUREAU_DIR = join(homedir(), ".bureau");
export const LOGS_DIR = join(BUREAU_DIR, "logs");
export const AGENTS_FILE = join(BUREAU_DIR, "agents.json");
export const OFFICE_PROMPT_FILE = join(BUREAU_DIR, "office-prompt.md");
export const OFFICE_CONFIG_FILE = join(BUREAU_DIR, "office-config.json");
export const TASKS_FILE = join(BUREAU_DIR, "tasks.json");
export const AGENT_HISTORY_FILE = join(BUREAU_DIR, "agent-history.json");
export const MANIFEST_FILE = join(BUREAU_DIR, "agents-summary.json");
export const RECENT_CWDS_FILE = join(BUREAU_DIR, "recent-cwds.json");

// Ensure directories exist
try {
  mkdirSync(BUREAU_DIR, { recursive: true });
  mkdirSync(LOGS_DIR, { recursive: true });
} catch {}
