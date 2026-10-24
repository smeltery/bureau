export const backendErrors = {
  "logs.backendError.timeout": "OpenCode request timed out at {path}.",
  "logs.backendError.heartbeat": "OpenCode event stream stopped sending heartbeats.",
  "logs.backendError.activeTurn": "OpenCode already has an active turn.",
  "logs.backendError.approval": "OpenCode supports Allow once and Deny.",
  "logs.backendError.noBody": "OpenCode event stream has no body.",
  "logs.backendError.uninitialized": "OpenCode transport is not initialized.",
  "logs.backendError.http": "OpenCode HTTP {status} at {path}.",
} as const;
