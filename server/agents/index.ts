// Public entry point for the agent manager. Re-exports the symbols consumed
// by server/index.ts. Everything else lives in the per-concern sub-modules.

export { buildSystemPrompt } from "./session/system-prompt.ts";
export { validateCwd } from "./session/paths.ts";
export { onEvent, getOfficeSettings } from "./state.ts";
export { getRooms, setOfficeSettings, setRoomSettings, validateEnvPath, swapDesks, createRoom, closeRoom, renameRoom, reorderRooms, moveAgent } from "./rooms.ts";
export {
  getAgent,
  getAgentDisplay,
  getAllAgents,
  getAgentLogs,
  getAgentCommands,
  listSessions,
  getCurrentSessionId,
  emitAgentDiff,
  emitAgentEditFile,
  emitAgentPreviewUrl,
  emitAgentReadFile,
  emitAgentTerminalCommand,
  openEditorFile,
  saveEditorFile,
  resolveEditorPathForAgent,
  spawn,
  kill,
  revive,
  getKilledAgentSummaries,
  restoreAgents,
} from "./lifecycle.ts";
export { editAgent, setAgentPrivileged } from "./settings.ts";
export { sendMessage } from "./conversation/send.ts";
export { dequeueMessage, enqueueMessage, flushQueue } from "./conversation/message-queue.ts";
export { abort, sendNow, newConversation, resume } from "./conversation/control.ts";
export { editMessage } from "./conversation/edit.ts";
export { setTopic, resetTopic } from "./topic.ts";
export { openTerminal, closeTerminal, getTerminalBuffer, terminalInput, terminalResize } from "./terminal.ts";
