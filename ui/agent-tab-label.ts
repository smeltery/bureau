import type { AgentState } from "../shared/types.ts";

const STATE_FACES: Record<AgentState, string> = {
  idle: "(-_-)zz",
  thinking: "~(o_o)~",
  tool_executing: "~(o_o)~",
  waiting_for_response: "(^_^)ﾉ",
  error: "(｡>﹏<｡)",
  stopped: "(-_-)zz",
};

export function faceForAgentState(state: AgentState): string {
  return STATE_FACES[state] ?? "";
}

export function agentTabLabel(name: string, state: AgentState): string {
  const face = faceForAgentState(state);
  return face ? `${face} ${name}` : name;
}
