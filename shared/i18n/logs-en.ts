export const logs = {
  "logs.interrupted": "Agent interrupted.",
  "logs.newConversation": "New conversation started.",
  "logs.handoffOpened": "Automatic handoff opened a fresh conversation. The brief will arrive before queued messages.",
  "logs.resumed": "Resumed session: {topic}",
  "logs.resumeFailed": "Failed to resume: {error}",
  "logs.newFailed": "Failed to start new conversation: {error}",
  "logs.interruptResumeFailed": "Failed to resume after interrupt: {error}",
  "logs.directoryUnavailable": "Session's saved directory `{storedCwd}` is unavailable ({error}); resuming in `{cwd}`.",
} as const;
