import { join } from "node:path";
import type { BackendCapabilities, ModelOption, PermissionModeOption } from "../types.ts";

export const OPENCODE_AUTH_FAILURE = "OpenCode authentication is not configured.";

export const AUTH_ERROR_PATTERNS = /opencode authentication is not configured|unauthori[zs]ed|not authenticated|authentication|auth.*expired|invalid.*token|login.*required|opencode_api_key|403|401/i;

export const LOGIN_INSTRUCTIONS =
  "OpenCode needs provider credentials. Add OPENCODE_API_KEY to your personal environment file, or use the profile-scoped login command below. Retry after active turns in this environment finish; existing history stays in place.";
export const ALREADY_AUTHED_INSTRUCTIONS =
  "OpenCode credentials (OPENCODE_API_KEY) are configured. Check the key in your personal environment file and retry; credential updates take effect between turns without clearing history.";

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

export function getOpenCodeLoginInstructions(opts?: { env?: { [key: string]: string | undefined }; profileDir?: string }): {
  text: string;
  commands?: string[];
} {
  if (opts?.env?.OPENCODE_API_KEY?.trim()) {
    return { text: ALREADY_AUTHED_INSTRUCTIONS };
  }
  const quote = (value: string) => "'" + value.replaceAll("'", "'\\''") + "'";
  const prefix = opts?.profileDir
    ? Object.entries({ HOME: "home", XDG_CONFIG_HOME: "config", XDG_DATA_HOME: "data", XDG_STATE_HOME: "state", XDG_CACHE_HOME: "cache" })
        .map(([key, directory]) => `${key}=${quote(join(opts.profileDir!, directory))}`)
        .join(" ") + " "
    : "";
  return { text: LOGIN_INSTRUCTIONS, commands: [`${prefix}opencode auth login`] };
}
