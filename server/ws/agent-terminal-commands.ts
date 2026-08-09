import type { ClientCommand, ServerMessage } from "../../shared/types.ts";
import * as AgentManager from "../agent-manager.ts";
import { broadcast } from "./broadcast.ts";

export type AgentTerminalCommand = Extract<ClientCommand, { type: "terminal_open" | "terminal_input" | "terminal_resize" | "terminal_close" }>;

// The terminal is DELIBERATELY out of reach for a privileged agent. It exists
// only on the WebSocket, whose `canUseAgent` resolves a browser session user
// (`getWsUser`) — an agent bearer token has no WS identity at all, so there is no
// privileged path to add or remove here. Keep it that way: this is an
// interactive root-equivalent shell on the office machine, and an agent that
// wanted one could already spawn a process in its own sandbox. Upstream excludes
// `terminal:use` from the privileged capability set for the same reason.
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
