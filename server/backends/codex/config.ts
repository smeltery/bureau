import type { BackendCapabilities, ModelOption, PermissionModeOption } from "../types.ts";
import { getCodexLoginCommands, isCodexAuthenticated } from "./native-bin.ts";

// Bureau runs codex against its own isolated CODEX_HOME (~/.bureau/codex-home/
// by default), separate from the user's interactive `~/.codex/`. That means
// the user needs a one-time `codex login` against bureau's CODEX_HOME.
export const LOGIN_INSTRUCTIONS = `To sign in to Codex, open User Settings → Connections to paste an OPENAI_API_KEY, or click [Copy to terminal] on one of the cards below:

- \`~/.bureau/bin/codex login\`: if running bureau locally
- \`~/.bureau/bin/codex login --device-auth\`: for remote or headless hosts (e.g. a Mac mini or Linux box you reach over a VPN)

Press Enter to run, follow the prompts, then \`/clear\` this conversation to apply the new auth. Other codex agents apply on their next \`/clear\`.

For envFile users with a custom CODEX_HOME: prefix the login commands above with \`CODEX_HOME=<your value>\` first.`;

export const ALREADY_AUTHED_INSTRUCTIONS = `Codex is signed in. Type \`/clear\` to refresh this agent's session and pick up the new auth.`;

export const AUTH_ERROR_PATTERNS = /unauthori[zs]ed|not authenticated|authentication|auth.*expired|invalid.*token|login.*required|chatgpt.*login|openai_api_key|403|401/i;

export const CODEX_THREAD_CONFIG_OVERRIDES: Readonly<Record<string, boolean>> = {
  "memories.use_memories": false,
  "memories.generate_memories": false,
};

// Capability flags for the Codex backend. Match the spec's parity table.
// hooks: false because Codex emits hook/* notifications but provides no
// programmatic register-from-client surface at 0.130.
export const CAPABILITIES: BackendCapabilities = {
  fork: false,
  hooks: false,
  skills: true,
  oneShot: true,
  canUseTool: true,
  topicGen: true,
  edit: true,
  mcp: true,
};

// Slugs verified against `codex debug models` on codex-cli 0.153.4
// (2026-09-05); mirror of CODEX_MODELS in shared/agent-models.ts.
export const MODEL_OPTIONS: ModelOption[] = [
  { value: "gpt-5.6-sol", label: "GPT-5.6 Sol" },
  { value: "gpt-6-astra", label: "GPT-6 Astra" },
  { value: "gpt-5.6-terra", label: "GPT-5.6 Terra" },
  { value: "gpt-5.6-luna", label: "GPT-5.6 Luna" },
  { value: "gpt-5.5", label: "GPT-5.5" },
  { value: "gpt-5.4", label: "GPT-5.4" },
  { value: "gpt-5.4-mini", label: "GPT-5.4 mini" },
];

export function modelDisplayLabel(slug: string): string {
  return MODEL_OPTIONS.find((m) => m.value === slug)?.label ?? slug;
}

// AskForApproval enum minus the deprecated "on-failure" variant.
export const PERMISSION_MODES: PermissionModeOption[] = [
  { value: "untrusted", label: "Untrusted — ask on every tool" },
  { value: "on-request", label: "On request — ask when model asks" },
  { value: "never", label: "Never ask (use with sandbox)" },
];

export const DEFAULT_SANDBOX_MODE = "danger-full-access";

export function getCodexLoginInstructions(opts?: { env?: { [key: string]: string | undefined } }): { text: string; commands?: string[] } {
  if (isCodexAuthenticated(opts?.env)) {
    return { text: ALREADY_AUTHED_INSTRUCTIONS };
  }
  return { text: LOGIN_INSTRUCTIONS, commands: getCodexLoginCommands() };
}
