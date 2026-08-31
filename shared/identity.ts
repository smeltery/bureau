// Identity formatting helpers shared between server and UI.
// `username` is the human boss who sent the message; agent senders use a
// distinct format so the receiving agent can tell the two apart and (for
// agent-to-agent traffic) reply via the same /api/agents/:id/messages endpoint.

export function formatUserPrefix(username: string | undefined): string {
  if (!username) return "";
  return `[${username}] `;
}

// Lowercase key used for users.json lookup and invite-binding. Display case
// is whatever the client sent; the key only normalizes for matching.
export function lowercaseKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}

// Prefix for messages that come from another agent. Distinguishes
// agent-to-agent traffic from human boss messages so the receiving agent
// can apply different authority rules; the id lets the receiver POST a
// reply directly without re-looking-up via agents-summary.json.
// Format: `"AgentName" (agent id: agent-1774...) from Room "RoomName"`.
export function formatAgentSenderPrefix(agentId: string, agentName: string, roomName: string): string {
  return `"${agentName}" (agent id: ${agentId}) from Room "${roomName}"`;
}

// Prefix for a message from an app the receiving agent built. Distinct from
// both other senders because an app carries no authority at all: it is a
// program the agent wrote, reporting to it. The name is the app's registered
// one, resolved server-side from its token.
export function formatAppSenderPrefix(appName: string): string {
  return `[app "${appName}"]`;
}

// Cron job names are free-form. Normalize before they enter an agent prompt so
// controls, newlines, and delimiter-like whitespace cannot forge a second
// sender line.
export function formatCronjobSenderPrefix(cronjobName: string): string {
  const normalized = cronjobName
    // eslint-disable-next-line no-control-regex -- controls are the threat here
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/"/g, "'")
    .trim()
    .slice(0, 80);
  return `[Cron job "${normalized}"]`;
}

const API_TOKEN_DEVICE_PREFIX = 'API token "';

export function formatApiTokenDevice(tokenName: string, tokenId: string): string {
  const normalized = tokenName
    // eslint-disable-next-line no-control-regex -- controls are the threat here
    .replace(/[\u0000-\u001f\u007f-\u009f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/"/g, "'")
    .trim()
    .slice(0, 64);
  return `${API_TOKEN_DEVICE_PREFIX}${normalized}" (${tokenId})`;
}

export function isApiTokenDevice(device: string | undefined): boolean {
  return device?.startsWith(API_TOKEN_DEVICE_PREFIX) === true;
}
