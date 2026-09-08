import type { AgentBackendType, AgentState } from "../../../shared/types.ts";

export function visualDeskState(state: AgentState): "working" | "waiting_for_response" | "error" | "idle" {
  switch (state) {
    case "thinking":
    case "tool_executing":
      return "working";
    case "waiting_for_response":
      return "waiting_for_response";
    case "error":
      return "error";
    default:
      return "idle";
  }
}

export const PLANT_VARIANTS: Array<Array<[string, string, number]>> = [
  [
    ["M0 0 Q-6 -8 -2 -14", "#3a7a3a", 1.5],
    ["M0 -2 Q4 -10 8 -12", "#4a8a4a", 1.2],
    ["M0 -1 Q-3 -6 1 -10", "#3a7a3a", 1],
  ],
  [
    ["M0 0 Q-8 -5 -10 -10", "#2e8a4a", 1.4],
    ["M0 -1 Q6 -8 10 -8", "#3a9a5a", 1.1],
    ["M0 0 Q-2 -9 2 -13", "#2e7a3a", 1],
  ],
  [
    ["M0 0 Q-2 -10 -1 -15", "#4a8a3a", 1.6],
    ["M0 -1 Q3 -10 5 -14", "#5a9a4a", 1.3],
    ["M0 0 Q-4 -7 -6 -11", "#4a7a3a", 1.1],
  ],
  [
    ["M0 0 Q-9 -6 -12 -9", "#3a8a4a", 1.3],
    ["M0 -1 Q8 -6 12 -8", "#4a9a3a", 1.2],
    ["M0 0 Q0 -8 -1 -13", "#3a7a4a", 1.4],
  ],
  [
    ["M0 0 Q-1 -10 0 -16", "#3a8a3a", 1.6],
    ["M0 -6 Q-6 -10 -8 -12", "#4a9a4a", 1],
    ["M0 -8 Q5 -11 7 -13", "#3a7a3a", 0.9],
  ],
];

export const BOOK_VARIANTS: Array<[string, string, string]> = [
  ["#30995a", "#2a8a4a", "#1e7a3c"],
  ["#3a6ea5", "#2e5e8a", "#224e74"],
  ["#a03a3a", "#8a2e2e", "#742222"],
  ["#7a5aa0", "#6a4a8a", "#5a3a74"],
  ["#c47a2a", "#aa6a22", "#8a5a1a"],
];

export const MUG_VARIANTS: Array<[string, string, string, string]> = [
  ["#E8E8E0", "#D0D0C8", "#F0F0E8", "#3A2010"],
  ["#2E5E8A", "#1E4A6E", "#3A6E9A", "#3A2010"],
  ["#C44040", "#A43030", "#D45050", "#3A2010"],
  ["#3A3A3A", "#2A2A2A", "#4A4A4A", "#3A2010"],
  ["#D4A04A", "#B88838", "#E0B05A", "#3A2010"],
];

export const DESKS_WITHOUT_PLANT = new Set([1, 3, 6]);

const CWD_CHARS_PER_LINE = 12;

export function wrapCwd(text: string): string[] {
  if (text.length <= CWD_CHARS_PER_LINE) return [text];
  const lines: string[] = [];
  let remaining = text;
  while (remaining.length > 0) {
    if (remaining.length <= CWD_CHARS_PER_LINE) {
      lines.push(remaining);
      break;
    }
    let breakAt = remaining.lastIndexOf("/", CWD_CHARS_PER_LINE);
    if (breakAt <= 0) breakAt = CWD_CHARS_PER_LINE;
    lines.push(remaining.slice(0, breakAt));
    remaining = remaining.slice(breakAt);
  }
  return lines;
}

/** Desk drinkware that signals Claude vs Codex at a glance. */
export function vesselForAgentType(agentType: AgentBackendType | undefined): "mug" | "cup" {
  return agentType === "codex" ? "cup" : "mug";
}
