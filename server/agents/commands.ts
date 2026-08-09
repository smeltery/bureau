// Declarative registry of every known Claude Code command and bundled skill.
// Pure data — no handler logic lives here.
//
// See docs/architecture/command-skill-system.md for the full design.
// Last updated: 2026-03-31 (Claude Code ~1.0.x)

import { bundledSkillCommands } from "./commands-bundled-skills.ts";
import { unsupportedHardcodedCommands } from "./commands-unsupported.ts";

export type CommandType = "hardcoded" | "bundled-skill";

export type CommandConfig = {
  type: CommandType;
  /** Does Bureau handle this command? */
  supported: boolean;
  /** Show in autocomplete? */
  autocomplete: boolean;
  /** Can user/project/bundled skills shadow this command? */
  overridable: boolean;
  /** Key into commandHandlers (required when supported: true) */
  handler?: string;
  /** Short description of what this command does */
  description?: string;
  /** Custom ephemeral message for unsupported commands (default is type-aware) */
  message?: string;
  /** Bare `/name` is a complete command and can run directly from command pickers. */
  autoRun?: boolean;
  /**
   * Marks this entry as an alias of another command. The other command is
   * the canonical name; this one is a friendlier shorthand. /help groups
   * canonicals + their aliases so the user sees a single line per command
   * rather than one per name.
   */
  aliasFor?: string;
};

// ---------------------------------------------------------------------------
// Registry
// ---------------------------------------------------------------------------

export const commands: Record<string, CommandConfig> = {
  // =========================================================================
  // Supported (Bureau built-in handlers)
  // =========================================================================
  clear: {
    type: "hardcoded",
    supported: true,
    autocomplete: true,
    overridable: false,
    handler: "clear",
    description: "Wipe conversation history",
    autoRun: true,
  },
  context: {
    type: "hardcoded",
    supported: true,
    autocomplete: true,
    overridable: false,
    handler: "context",
    description: "Visualize context window usage",
    autoRun: true,
  },
  handoff: {
    type: "hardcoded",
    supported: true,
    autocomplete: true,
    overridable: false,
    handler: "handoff",
    description: "Draft a restart prompt for a fresh session",
    autoRun: true,
  },
  "handoff-apply": {
    type: "hardcoded",
    supported: true,
    autocomplete: false,
    overridable: false,
    handler: "handoffApply",
    description: "Clear this session and restart from a handoff prompt",
  },
  help: {
    type: "hardcoded",
    supported: true,
    autocomplete: true,
    overridable: false,
    handler: "help",
    description: "List all available commands",
    autoRun: true,
  },
  "bureau-usage": {
    type: "hardcoded",
    supported: true,
    autocomplete: true,
    overridable: false,
    handler: "bureauUsage",
    description: "Per-agent / per-room / per-cron-job token spend",
    autoRun: true,
  },
  "bureau-storage": {
    type: "hardcoded",
    supported: true,
    autocomplete: true,
    overridable: false,
    handler: "bureauStorage",
    description: "Persisted office state, backups, and per-agent storage",
    autoRun: true,
  },
  resume: {
    type: "hardcoded",
    supported: true,
    autocomplete: true,
    overridable: false,
    handler: "resume",
    description: "Pick up a previous session",
    autoRun: true,
  },
  login: {
    type: "hardcoded",
    supported: true,
    autocomplete: true,
    overridable: false,
    handler: "login",
    description: "Show how to authenticate this agent",
    autoRun: true,
  },
  logout: {
    type: "hardcoded",
    supported: false,
    autocomplete: false,
    overridable: false,
    description: "Log out of your Anthropic account",
    message: "To log out:\n1. Open the built-in terminal\n2. Run `claude logout`",
  },
  "bureau-all-hands": {
    type: "hardcoded",
    supported: true,
    autocomplete: true,
    overridable: false,
    handler: "bureauAllHands",
    description: "Summary of all agents and their conversations",
    autoRun: true,
  },
  "bureau-system-prompt": {
    type: "hardcoded",
    supported: true,
    autocomplete: true,
    overridable: false,
    handler: "bureauSystemPrompt",
    description: "Show the full system prompt this agent receives",
    autoRun: true,
  },
  "bureau-cronjob-system-prompt": {
    type: "hardcoded",
    supported: true,
    autocomplete: true,
    overridable: false,
    handler: "bureauCronjobSystemPrompt",
    description: "Show the system prompt a cron job receives (pass name or id)",
  },
  "bureau-diff": {
    type: "hardcoded",
    supported: true,
    autocomplete: true,
    overridable: false,
    handler: "bureauDiff",
    description: "Peek uncommitted changes in the agent's cwd (or pass a directory)",
    autoRun: true,
  },
  "bureau-edit": {
    type: "hardcoded",
    supported: true,
    autocomplete: true,
    overridable: false,
    handler: "bureauEdit",
    description: "Open a file in the editor side panel (relative to cwd, absolute, or ~/...)",
  },
  "bureau-message": {
    type: "hardcoded",
    supported: true,
    autocomplete: true,
    overridable: false,
    handler: "bureauMessage",
    description: "Send a message to another agent's chat (queues if busy)",
  },
  ...unsupportedHardcodedCommands,
  ...bundledSkillCommands,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** All command names that should appear in autocomplete from the config. */
export function autocompleteCommands(): { name: string; description?: string; aliasFor?: string; autoRun?: boolean }[] {
  return Object.entries(commands)
    .filter(([, cfg]) => cfg.autocomplete)
    .map(([name, cfg]) => ({
      name,
      description: cfg.description,
      ...(cfg.aliasFor ? { aliasFor: cfg.aliasFor } : {}),
      ...(cfg.autoRun === true ? { autoRun: true } : {}),
    }));
}

/** Unsupported message for a command, with type-aware defaults. */
export function unsupportedMessage(name: string): string {
  const cfg = commands[name];
  const desc = cfg?.description ? ` (${cfg.description.toLowerCase()})` : "";
  if (cfg?.message) return cfg.message;
  if (!cfg) return `\`/${name}\` is not available in Bureau.`;
  if (cfg.type === "hardcoded") {
    return `\`/${name}\`${desc} is a Claude Code command, but it's not supported in Bureau.`;
  }
  if (cfg.type === "bundled-skill") {
    return `\`/${name}\`${desc} is a Claude Code bundled skill, but it's not supported in Bureau. You can override it by creating your own skill file.`;
  }
  return `\`/${name}\` is not available in Bureau.`;
}
