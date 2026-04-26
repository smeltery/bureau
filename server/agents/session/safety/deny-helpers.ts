import type { HookJSONOutput } from "@anthropic-ai/claude-agent-sdk";
import { basename } from "path";

// ---------------------------------------------------------------------------
// Primitive deny / allow constructors
// ---------------------------------------------------------------------------

export function deny(reason: string): HookJSONOutput {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse" as const,
      permissionDecision: "deny" as const,
      permissionDecisionReason: reason,
    },
  };
}

export function allow(): HookJSONOutput {
  return {};
}

// ---------------------------------------------------------------------------
// Human-readable deny messages (shared formatter across hook callbacks)
// ---------------------------------------------------------------------------

export function denyMessage(reason: string, command: string): HookJSONOutput {
  return deny(
    `BLOCKED by bureau safety hooks\n\n` +
      `Reason: ${reason}\n\n` +
      `Command: ${command}\n\n` +
      `If this operation is truly needed, ask the user for explicit ` +
      `permission and have them run the command manually.`,
  );
}

export function denySecretRead(target: string, tool: string): HookJSONOutput {
  return deny(
    `BLOCKED by bureau safety hooks\n\n` +
      `Reason: "${basename(target)}" may contain secrets. Agents are not allowed ` +
      `to read sensitive files (.env, private keys, credentials, etc.).\n\n` +
      `${tool} target: ${target}\n\n` +
      `If you need a value from this file, ask the user to provide it.`,
  );
}
