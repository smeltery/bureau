// Identity formatting helpers shared between server and UI.
// `username` is the human boss who sent the message; agent senders use a
// distinct format so the receiving agent can tell the two apart and (for
// agent-to-agent traffic) reply via the same /agents/:id/message endpoint.

export function formatUserPrefix(username: string | undefined): string {
  if (!username) return "";
  return `[${username}] `;
}

// Prefix for messages that come from another agent. Distinguishes
// agent-to-agent traffic from human boss messages so the receiving agent
// can apply different authority rules; the id lets the receiver POST a
// reply directly without re-looking-up via agents-summary.json.
// Format: `"AgentName" (agent id: agent-1774...) from Room "RoomName"`.
export function formatAgentSenderPrefix(agentId: string, agentName: string, roomName: string): string {
  return `"${agentName}" (agent id: ${agentId}) from Room "${roomName}"`;
}
