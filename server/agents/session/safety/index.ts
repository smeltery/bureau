/**
 * Safety hooks for bureau agents.
 *
 * Injected as PreToolUse hooks into every agent's SDK session. Four concerns:
 *
 *   1. Git safety — block destructive git commands (checkout --, reset --hard, etc.)
 *   2. Filesystem safety — block rm -rf and similar
 *   3. Bureau config protection — block all writes to ~/.bureau/
 *   4. Secrets protection — block reads of .env, private keys, credentials, etc.
 *
 * Read operations on ~/.bureau/ are always allowed (agents need discovery/logs).
 */

import type {
  HookCallback,
  HookCallbackMatcher,
  HookEvent,
  PreToolUseHookInput,
} from "@anthropic-ai/claude-agent-sdk";
import { basename, resolve } from "path";
import { homedir } from "os";
import { allow, deny, denyMessage, denySecretRead } from "./deny-helpers.ts";
import { normalizeAbsolutePaths, stripQuotedStrings } from "./bash-parser.ts";
import { DESTRUCTIVE_PATTERNS, SAFE_PATTERNS } from "./patterns.ts";
import { BUREAU_DIR, commandWritesToBureau } from "./bureau-protection.ts";
import { FILE_READ_COMMANDS, isSensitiveFile } from "./secrets.ts";

// ---------------------------------------------------------------------------
// Hook callbacks
// ---------------------------------------------------------------------------

const checkBashSafety: HookCallback = async (input) => {
  const { tool_input } = input as PreToolUseHookInput;
  const command = (tool_input as { command?: string })?.command;
  if (typeof command !== "string" || !command) return allow();

  // Strip quoted strings so patterns don't match commit messages, echo args, etc.
  const stripped = stripQuotedStrings(command);
  const normalized = normalizeAbsolutePaths(stripped);

  // Check ~/.bureau/ write protection first
  if (commandWritesToBureau(stripped)) {
    return denyMessage(
      "Writing to ~/.bureau/ is not allowed. This directory is managed by the bureau server. " +
      "Read operations (cat, ls, grep, etc.) are permitted.",
      command,
    );
  }

  // Check sensitive file reads via shell commands (cat .env, head key.pem, etc.)
  const subCommands = normalized.split(/[|;&]+/).map(s => s.trim());
  for (const sub of subCommands) {
    const tokens = sub.split(/\s+/);
    const cmd = tokens[0]?.replace(/^.*\//, "") ?? "";
    if (!FILE_READ_COMMANDS.includes(cmd)) continue;
    // Check all non-flag arguments as potential file paths
    for (const arg of tokens.slice(1)) {
      if (arg.startsWith("-")) continue;
      if (isSensitiveFile(arg)) {
        return denyMessage(
          `"${basename(arg)}" may contain secrets. Agents are not allowed ` +
          `to read sensitive files (.env, private keys, credentials, etc.). ` +
          `If you need a value from this file, ask the user to provide it.`,
          command,
        );
      }
    }
  }

  // Check safe patterns first (allowlist)
  for (const pattern of SAFE_PATTERNS) {
    if (pattern.test(normalized)) return allow();
  }

  // Check destructive patterns (blocklist)
  for (const [pattern, reason] of DESTRUCTIVE_PATTERNS) {
    if (pattern.test(normalized)) {
      return denyMessage(reason, command);
    }
  }

  return allow();
};

const checkWriteEditSafety: HookCallback = async (input) => {
  const { tool_name, tool_input } = input as PreToolUseHookInput;
  const filePath = (tool_input as { file_path?: string })?.file_path;
  if (typeof filePath !== "string" || !filePath) return allow();

  // Resolve ~ and relative paths
  const resolved = filePath.startsWith("~/")
    ? resolve(homedir(), filePath.slice(2))
    : filePath.startsWith("~")
      ? homedir()
      : resolve(filePath);

  if (resolved === BUREAU_DIR || resolved.startsWith(BUREAU_DIR + "/")) {
    return deny(
      `BLOCKED by bureau safety hooks\n\n` +
      `Reason: Writing to ~/.bureau/ is not allowed. This directory is managed by the bureau server.\n\n` +
      `${tool_name} target: ${filePath}\n\n` +
      `If this operation is truly needed, ask the user for explicit ` +
      `permission and have them run the command manually.`
    );
  }

  return allow();
};

const checkSensitiveFileRead: HookCallback = async (input) => {
  const { tool_name, tool_input } = input as PreToolUseHookInput;
  const filePath = (tool_input as { file_path?: string })?.file_path;
  if (typeof filePath !== "string" || !filePath) return allow();

  if (isSensitiveFile(filePath)) {
    return denySecretRead(filePath, tool_name);
  }

  return allow();
};

// ---------------------------------------------------------------------------
// Export — wire into SDKSessionOptions.hooks
// ---------------------------------------------------------------------------

export function createSafetyHooks(): Partial<Record<HookEvent, HookCallbackMatcher[]>> {
  return {
    PreToolUse: [
      { matcher: "Bash", hooks: [checkBashSafety] },
      { matcher: "Read", hooks: [checkSensitiveFileRead] },
      { matcher: "Write", hooks: [checkWriteEditSafety] },
      { matcher: "Edit", hooks: [checkWriteEditSafety] },
    ],
  };
}
