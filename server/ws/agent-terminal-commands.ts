import type { ClientCommand, ServerMessage } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import { broadcast } from "./broadcast.ts";

export type AgentTerminalCommand = Extract<ClientCommand, { type: "terminal_open" | "terminal_input" | "terminal_resize" | "terminal_close" }>;

export function handleAgentTerminalCommand(cmd: AgentTerminalCommand, canUseAgent: (agentId: string) => boolean): void {
  if (!canUseAgent(cmd.agentId)) return;
  switch (cmd.type) {
    case "terminal_open": {
      const opened = AgentManager.openTerminal(cmd.agentId);
      if (opened) {
        // Replay buffered output so the browser catches up.
        const buffer = AgentManager.getTerminalBuffer(cmd.agentId);
        if (buffer) {
          broadcast({ type: "terminal_output", agentId: cmd.agentId, data: buffer } as ServerMessage);
        }
      }
      return;
    }
    case "terminal_input":
      AgentManager.terminalInput(cmd.agentId, cmd.data);
      return;
    case "terminal_resize":
      AgentManager.terminalResize(cmd.agentId, cmd.cols, cmd.rows);
      return;
    case "terminal_close":
      AgentManager.closeTerminal(cmd.agentId);
      return;
  }
}
