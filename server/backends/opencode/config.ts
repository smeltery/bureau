import type { BackendCapabilities, ModelOption, PermissionModeOption } from "../types.ts";

export const OPENCODE_AUTH_FAILURE = "OpenCode authentication is not configured.";

export const AUTH_ERROR_PATTERNS = /opencode authentication is not configured|unauthori[zs]ed|not authenticated|authentication|auth.*expired|invalid.*token|login.*required|opencode_api_key|403|401/i;

export const LOGIN_INSTRUCTIONS = `OpenCode needs provider credentials.

1. Add \`OPENCODE_API_KEY\` under Settings → You → Individual connections (or your env file / agent Variables), then \`/clear\` this conversation
2. Or sign in with the host CLI: install \`opencode\` on PATH and run \`opencode auth login\`, then \`/clear\`

Other OpenCode agents pick up the new auth on their next \`/clear\`.`;

export const ALREADY_AUTHED_INSTRUCTIONS = `OpenCode credentials look present (\`OPENCODE_API_KEY\`). Type \`/clear\` to refresh this agent's session and pick up the new auth.`;

export const CAPABILITIES: BackendCapabilities = {
  fork: true,
  hooks: false,
  skills: false,
  oneShot: true,
  canUseTool: true,
  topicGen: true,
  edit: true,
  mcp: false,
};

// Static fallbacks when live /provider discovery is unavailable. IDs use
// OpenCode's provider/model form.
export const MODEL_OPTIONS: ModelOption[] = [
  { value: "opencode/nemotron-3-ultra-free", label: "Nemotron 3 Ultra (free)" },
  { value: "opencode/gpt-5-nano", label: "GPT-5 Nano (OpenCode)" },
  { value: "opencode/claude-sonnet-4", label: "Claude Sonnet 4 (OpenCode)" },
  { value: "opencode/gemini-2.5-flash", label: "Gemini 2.5 Flash (OpenCode)" },
  { value: "opencode/big-pickle", label: "Big Pickle (free)" },
];

export const DEFAULT_OPENCODE_MODEL = MODEL_OPTIONS[0].value;

export const PERMISSION_MODES: PermissionModeOption[] = [
  { value: "default", label: "Ask" },
  { value: "bypassPermissions", label: "Bypass all permissions" },
];

// Named OpenCode agents written into the local serve config. Bypass maps to
// the unattended cron profile so schedules never hang on /resolve.
export const OPENCODE_CRON_AGENT = "bureau-cron";

export const DEFAULT_OPENCODE_CONFIG: Record<string, unknown> = {
  autoupdate: false,
  share: "disabled",
  permission: { bash: "ask", edit: "ask", question: "deny" },
  agent: {
    [OPENCODE_CRON_AGENT]: {
      description: "Bureau unattended OpenCode run",
      mode: "primary",
      permission: {
        bash: "ask",
        edit: "ask",
        task: "deny",
        question: "deny",
      },
    },
  },
};

export function permissionAgent(permissionMode: string): string | undefined {
  return permissionMode === "bypassPermissions" ? OPENCODE_CRON_AGENT : undefined;
}

export function getOpenCodeLoginInstructions(opts?: { env?: { [key: string]: string | undefined } }): {
  text: string;
  commands?: string[];
} {
  if (opts?.env?.OPENCODE_API_KEY?.trim()) {
    return { text: ALREADY_AUTHED_INSTRUCTIONS };
  }
  return { text: LOGIN_INSTRUCTIONS, commands: ["opencode auth login"] };
}
