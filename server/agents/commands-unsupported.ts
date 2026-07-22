import type { CommandConfig } from "./commands.ts";

export const UNSUPPORTED_HARDCODED: Omit<CommandConfig, "message"> = {
  type: "hardcoded",
  supported: false,
  autocomplete: false,
  overridable: false,
};

export const unsupportedHardcodedCommands: Record<string, CommandConfig> = {
  // --- Session & context ---
  compact: { ...UNSUPPORTED_HARDCODED, description: "Compress context", message: "`/compact` is not yet supported in Bureau. Context is auto-compacted by the SDK." },
  branch: { ...UNSUPPORTED_HARDCODED, description: "Branch conversation into new session" },
  fork: { ...UNSUPPORTED_HARDCODED, description: "Branch conversation into new session" },
  export: { ...UNSUPPORTED_HARDCODED, description: "Export conversation to file" },
  plan: { ...UNSUPPORTED_HARDCODED, description: "Toggle plan mode" },
  rename: { ...UNSUPPORTED_HARDCODED, description: "Rename current session" },
  reset: { type: "hardcoded", supported: true, autocomplete: false, overridable: false, handler: "clear", description: "Reset conversation", autoRun: true },
  new: { type: "hardcoded", supported: true, autocomplete: false, overridable: false, handler: "clear", description: "Start new conversation", autoRun: true },

  // --- Model & performance ---
  model: { type: "hardcoded", supported: true, autocomplete: true, overridable: false, handler: "model", description: "Switch model", autoRun: true },
  fast: { ...UNSUPPORTED_HARDCODED, description: "Toggle speed-optimized mode" },
  effort: { type: "hardcoded", supported: true, autocomplete: true, overridable: false, handler: "effort", description: "Set thinking effort level", autoRun: true },
  advisor: { ...UNSUPPORTED_HARDCODED, description: "Toggle advisor mode" },

  // --- Cost & usage ---
  cost: { ...UNSUPPORTED_HARDCODED, description: "Token usage and cost estimate", message: "`/cost` is a Claude Code command for API users. Bureau uses subscription-based billing." },
  usage: {
    type: "hardcoded",
    supported: true,
    autocomplete: true,
    overridable: false,
    handler: "usage",
    description: "Where to check subscription and office usage",
    autoRun: true,
  },
  stats: { ...UNSUPPORTED_HARDCODED, description: "Usage patterns over time" },
  "extra-usage": { ...UNSUPPORTED_HARDCODED, description: "Extra usage options" },
  "rate-limit-options": { ...UNSUPPORTED_HARDCODED, description: "Rate limit configuration" },

  // --- Code & file operations ---
  diff: {
    type: "hardcoded",
    supported: true,
    autocomplete: true,
    overridable: false,
    handler: "bureauDiff",
    description: "Peek uncommitted changes in the agent's cwd (or pass a directory)",
    aliasFor: "bureau-diff",
    autoRun: true,
  },
  rewind: { ...UNSUPPORTED_HARDCODED, description: "Undo changes and revert conversation" },
  checkpoint: { ...UNSUPPORTED_HARDCODED, description: "Undo changes and revert conversation" },
  copy: { ...UNSUPPORTED_HARDCODED, description: "Copy last response to clipboard" },
  files: { ...UNSUPPORTED_HARDCODED, description: "List files in context" },
  "add-dir": { ...UNSUPPORTED_HARDCODED, description: "Add additional working directories" },

  // --- Side channel ---
  btw: { ...UNSUPPORTED_HARDCODED, description: "Ask without polluting main context" },

  // --- Configuration & management ---
  config: { ...UNSUPPORTED_HARDCODED, description: "Open settings interface" },
  settings: { ...UNSUPPORTED_HARDCODED, description: "Open settings interface" },
  hooks: { ...UNSUPPORTED_HARDCODED, description: "Manage lifecycle hooks" },
  permissions: { ...UNSUPPORTED_HARDCODED, description: "Manage tool permissions" },
  keybindings: { ...UNSUPPORTED_HARDCODED, description: "Edit key bindings" },
  memory: { ...UNSUPPORTED_HARDCODED, description: "View/edit persistent memory" },
  mcp: { ...UNSUPPORTED_HARDCODED, description: "Manage MCP server connections" },
  ide: { ...UNSUPPORTED_HARDCODED, description: "Manage IDE integrations" },
  agents: { ...UNSUPPORTED_HARDCODED, description: "Manage custom subagents" },
  skills: { ...UNSUPPORTED_HARDCODED, description: "List all available skills" },
  sandbox: { ...UNSUPPORTED_HARDCODED, description: "Manage sandbox settings" },
  "privacy-settings": { ...UNSUPPORTED_HARDCODED, description: "Manage privacy settings" },
  theme: { ...UNSUPPORTED_HARDCODED, description: "Change color theme" },
  color: { ...UNSUPPORTED_HARDCODED, description: "Change color theme" },
  vim: { ...UNSUPPORTED_HARDCODED, description: "Toggle vim keybindings" },
  "terminal-setup": { ...UNSUPPORTED_HARDCODED, description: "Configure terminal integration" },
  "reload-plugins": {
    ...UNSUPPORTED_HARDCODED,
    description: "Reload installed plugins",
    message: "To reload plugins, open the built-in terminal (click the terminal icon on the agent's desk), run `claude`, and type `/reload-plugins`.",
  },

  // --- Background & system ---
  tasks: { ...UNSUPPORTED_HARDCODED, description: "List/manage background tasks" },
  bashes: { ...UNSUPPORTED_HARDCODED, description: "List/manage background tasks" },
  doctor: { ...UNSUPPORTED_HARDCODED, description: "Check installation health" },
  feedback: { ...UNSUPPORTED_HARDCODED, description: "Report bugs to Anthropic" },
  bug: { ...UNSUPPORTED_HARDCODED, description: "Report bugs to Anthropic" },
  "release-notes": { ...UNSUPPORTED_HARDCODED, description: "View release notes" },
  heapdump: { ...UNSUPPORTED_HARDCODED, description: "Dump heap for debugging" },
  status: { ...UNSUPPORTED_HARDCODED, description: "Show system status" },
  tag: { ...UNSUPPORTED_HARDCODED, description: "Tag current conversation" },
  init: { ...UNSUPPORTED_HARDCODED, description: "Initialize Claude Code in a project" },
  "install-github-app": { ...UNSUPPORTED_HARDCODED, description: "Set up Claude GitHub PR review app" },
  pr_comments: { ...UNSUPPORTED_HARDCODED, description: "View PR comments" },

  // --- Desktop / mobile / remote ---
  desktop: { ...UNSUPPORTED_HARDCODED, description: "Open desktop app" },
  mobile: { ...UNSUPPORTED_HARDCODED, description: "Open mobile app" },
  chrome: { ...UNSUPPORTED_HARDCODED, description: "Open Chrome extension" },
  session: { ...UNSUPPORTED_HARDCODED, description: "Manage sessions" },
  teleport: { ...UNSUPPORTED_HARDCODED, description: "Transfer session to another device" },
  "remote-env": { ...UNSUPPORTED_HARDCODED, description: "Configure remote environment" },

  // --- Misc ---
  exit: { ...UNSUPPORTED_HARDCODED, description: "Exit Claude Code", message: "Use the Bureau UI to manage agents. `/exit` only works in the Claude Code CLI." },
  stickers: { ...UNSUPPORTED_HARDCODED, description: "Fun stickers" },
  upgrade: { ...UNSUPPORTED_HARDCODED, description: "Upgrade Claude Code" },
  plugin: {
    ...UNSUPPORTED_HARDCODED,
    description: "Manage plugins (use the Plugins panel)",
    message:
      "Plugin management lives in the Plugins panel — click **Plugins** in the office toolbar to browse, install, enable, disable, or remove Claude Code plugins and marketplaces.\n\nNewly installed plugins activate when an agent's next session starts (restart or `/resume` running agents to pick them up).",
  },
};
