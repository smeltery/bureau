// Public entry point for the agent manager. Re-exports the symbols consumed
// by server/index.ts. Everything else lives in the per-concern sub-modules.

export { buildSystemPrompt } from "./session/system-prompt.ts";
export { validateCwd } from "./session/paths.ts";
export { onEvent, getOfficeSettings } from "./state.ts";
export {
  getRooms,
  getRoomSettings,
  officeSettingsVersion,
  roomSettingsVersion,
  setOfficeSettings,
  setRoomSettings,
  setRoomPet,
  setRoomSkin,
  validateEnvPath,
  swapDesks,
  createRoom,
  closeRoom,
  renameRoom,
  reorderRooms,
  moveAgent,
} from "./rooms.ts";
export {
  getAgent,
  getAgentInstructions,
  getAgentDisplay,
  getAllAgents,
  getAgentLogs,
  getAgentCommands,
  getAgentContextUsage,
  getAgentInFlightTurnForLogs,
  getAgentInFlightTurnForManifest,
  getAgentPendingPrompt,
  listSessions,
  getCurrentSessionId,
  emitAgentDiff,
  emitAgentEditFile,
  emitAgentBrowser,
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
  getKilledAgentSummariesForManager,
  killedAgentManagerUserId,
  restoreAgents,
} from "./lifecycle.ts";
export { editAgent, setAgentPrivileged } from "./settings.ts";
export { sendMessage } from "./conversation/send.ts";
export { dequeueMessage, enqueueMessage, flushQueue } from "./conversation/message-queue.ts";
export { abort, sendNow, newConversation, handoff, resume } from "./conversation/control.ts";
export { editMessage } from "./conversation/edit.ts";
export { setTopic, resetTopic } from "./topic.ts";
export { ensureSlide, getSlideDeck } from "./slides.ts";
export { openTerminal, closeTerminal, getTerminalBuffer, terminalInput, terminalResize } from "./terminal.ts";
export { startBusyTurnWatchdog, sweepBusyTurnWatchdog, _testLastForcedRecoveryAt, _testSetBusyTurnWatchdogStuckMs } from "./queue-watchdog.ts";
