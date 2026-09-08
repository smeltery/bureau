import type { AgentBackendType } from "../../../shared/types.ts";

export const ENGINE_OPTIONS: Array<{
  agentType: AgentBackendType;
  label: string;
  blurb: string;
  accent: string;
}> = [
  {
    agentType: "claude",
    label: "Claude",
    blurb: "Works with your Claude Code login.",
    accent: "rgba(100,160,255,0.85)",
  },
  {
    agentType: "codex",
    label: "Codex",
    blurb: "Works with your ChatGPT login.",
    accent: "rgba(120,220,160,0.85)",
  },
  {
    agentType: "opencode",
    label: "OpenCode",
    blurb: "Uses the opencode CLI on PATH + OPENCODE_API_KEY.",
    accent: "rgba(220,160,90,0.9)",
  },
];

export const ENGINE_ACCENT: Record<AgentBackendType, string> = {
  claude: "rgba(100,160,255,0.85)",
  codex: "rgba(120,220,160,0.85)",
  opencode: "rgba(220,160,90,0.9)",
};
