// Checks for the human-facing Claude Code CLI and credentials.
//
// The Claude Agent SDK ships its own native binary for agent runtime. The
// standalone `claude` command is only needed for the human login flow:
// running `claude` then `/login` writes credentials the SDK can read.

import { execSync } from "child_process";
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";

let cachedClaudeOnPath: boolean | null = null;

export function isClaudeCodeInstalled(): boolean {
  if (cachedClaudeOnPath !== null) return cachedClaudeOnPath;
  try {
    execSync("which claude", { stdio: "pipe" });
    cachedClaudeOnPath = true;
  } catch {
    cachedClaudeOnPath = false;
  }
  return cachedClaudeOnPath;
}

export function isClaudeCodeAuthenticated(env?: { [key: string]: string | undefined }): boolean {
  const effective = env ?? process.env;
  if (effective.ANTHROPIC_API_KEY) return true;
  return existsSync(join(homedir(), ".claude", ".credentials.json"));
}
