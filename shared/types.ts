import type { AgentPermissionMode } from "./agent-models.ts";
import { generateHexId } from "./tasks.ts";

export {
  CODEX_MODELS,
  DEFAULT_AGENT_CAPABILITIES,
  DEFAULT_EFFORT,
  EFFORT_LEVELS,
  FAMILY_TO_MODEL,
  MODEL_FAMILIES,
  effortDisplayLabel,
  familyAllowsAutoPermission,
  familyDisplayLabel,
  familyFromLegacyModel,
  isClaudeFamily,
  modelVersionLabel,
} from "./agent-models.ts";
export type {
  AgentBackendType,
  AgentInfo,
  AgentOutfit,
  AgentState,
  KilledAgentSummary,
  MemoryItem,
  MemoryScope,
  QueuedMessage,
  QueuedSender,
  SessionInfo,
  SkillInfo,
  SkillOrigin,
} from "./agent-types.ts";
export { KILLED_AGENT_CHIP_CAP } from "./agent-types.ts";
export type { AgentCapabilities, AgentPermissionMode, ClaudeModel, ClaudePermissionMode, CodexApprovalPolicy, CodexSandboxMode, EffortLevel, ModelFamily } from "./agent-models.ts";
export { cronjobRunStreamId, humanizeSchedule, parseStreamId } from "./cronjobs.ts";
export type { Cronjob, CronjobPermissionMode, CronjobRun, CronjobRunStatus, CronjobRunTrigger, Schedule } from "./cronjobs.ts";
export type { CCAvailablePlugin, CCInstalledPlugin, CCMarketplace, CCPluginScope, CCPluginsState } from "./cc-plugin-types.ts";
export type { Attachment, DiffFileSummary, DiffPayload, FilePayload, LogEntry, TerminalCommandPayload } from "./log-types.ts";
export { generateHexId, generateTaskId, isValidPriority, isValidStatus } from "./tasks.ts";
export type { TaskItem, TaskPriority, TaskStatus } from "./tasks.ts";
export type { InviteWire, OfficeSettings, PresenceInfo, RoomWire, SessionContext, SessionWire, UserRecord, UserRole } from "./user-types.ts";
export type { AgentSaveResponse, ClientCommand, CwdValidationResponse, ServerMessage, SettingsSaveResponse, SettingsValidationResponse } from "./wire-types.ts";

export function generateCronjobId(existing?: string[]): string {
  return generateHexId(existing);
}

export function generateCronjobRunId(existing?: string[]): string {
  return generateHexId(existing);
}

// Generate a stable 8-char hex room ID (used at room creation and during migration)
export function generateRoomId(existing?: string[]): string {
  return generateHexId(existing);
}
