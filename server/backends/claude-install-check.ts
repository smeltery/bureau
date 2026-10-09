// Local credential presence and availability of the bundled or host Claude CLI.
import { existsSync } from "fs";
import { homedir } from "os";
import { join } from "path";
import { claudeLoginCommand } from "./claude/login-command.ts";

export function isClaudeCodeInstalled(env?: Record<string, string | undefined>): boolean {
  return claudeLoginCommand(env) !== null;
}

export function isClaudeCodeAuthenticated(env?: { [key: string]: string | undefined }): boolean {
  const effective = env ?? process.env;
  if (isClaudeCloudSelected(effective)) return true;
  if ([effective.ANTHROPIC_API_KEY, effective.CLAUDE_CODE_OAUTH_TOKEN, effective.ANTHROPIC_AUTH_TOKEN].some((value) => value?.trim())) return true;
  const configDir = effective.CLAUDE_CONFIG_DIR?.trim() || join(homedir(), ".claude");
  return existsSync(join(configDir, ".credentials.json"));
}

function enabled(value: string | undefined): boolean {
  switch (value?.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
    case "on":
      return true;
    default:
      return false;
  }
}

export function isClaudeCloudSelected(env: { [key: string]: string | undefined } = process.env): boolean {
  return enabled(env.CLAUDE_CODE_USE_BEDROCK) || enabled(env.CLAUDE_CODE_USE_VERTEX);
}
