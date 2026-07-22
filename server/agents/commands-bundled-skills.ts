import type { CommandConfig } from "./commands.ts";

const UNSUPPORTED_BUNDLED_SKILL: Omit<CommandConfig, "message"> = {
  type: "bundled-skill",
  supported: false,
  autocomplete: false,
  overridable: true,
};

export const bundledSkillCommands: Record<string, CommandConfig> = {
  batch: { ...UNSUPPORTED_BUNDLED_SKILL, description: "Decompose into parallel worktree agents" },
  "claude-api": { ...UNSUPPORTED_BUNDLED_SKILL, description: "Load API/SDK reference for detected language" },
  "claude-in-chrome": { ...UNSUPPORTED_BUNDLED_SKILL, description: "Automate Chrome browser interactions" },
  debug: { ...UNSUPPORTED_BUNDLED_SKILL, description: "Diagnose session/tool issues from debug log" },
  "keybindings-help": { ...UNSUPPORTED_BUNDLED_SKILL, description: "Customize keyboard shortcuts" },
  loop: {
    ...UNSUPPORTED_BUNDLED_SKILL,
    description: "Run a prompt on a recurring schedule",
    message: "not supported natively; see if the Cronjobs tab or scheduled messages satisfy your use case",
  },
  "lorem-ipsum": { ...UNSUPPORTED_BUNDLED_SKILL, description: "Generate placeholder text" },
  review: { ...UNSUPPORTED_BUNDLED_SKILL, description: "Code review for bugs, logic, and edge cases" },
  schedule: { ...UNSUPPORTED_BUNDLED_SKILL, description: "Create cron-scheduled remote agents" },
  "security-review": { ...UNSUPPORTED_BUNDLED_SKILL, description: "Security-focused code review" },
  simplify: { ...UNSUPPORTED_BUNDLED_SKILL, description: "Code cleanup and reuse analysis" },
  skillify: { ...UNSUPPORTED_BUNDLED_SKILL, description: "Capture processes as reusable skills" },
  stuck: { ...UNSUPPORTED_BUNDLED_SKILL, description: "Diagnose frozen/slow sessions" },
  ultrareview: { ...UNSUPPORTED_BUNDLED_SKILL, description: "Ultra-thorough PR review" },
  "update-config": { ...UNSUPPORTED_BUNDLED_SKILL, description: "Configure settings.json" },
};
