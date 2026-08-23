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
  AgentContextUsageSnapshot,
  AgentInfo,
  AgentOutfit,
  AgentState,
  AgentSubscriptionUsage,
  AgentSubscriptionWindow,
  KilledAgentSummary,
  LogInFlightTurn,
  ManifestInFlightTurn,
  MemoryItem,
  MemoryScope,
  QueuedMessage,
  QueuedSender,
  ScheduledMessageEntry,
  SessionInfo,
  SkillInfo,
  SkillOrigin,
} from "./agent-types.ts";
export { KILLED_AGENT_CHIP_CAP } from "./agent-types.ts";
export { injectedMemorySize } from "./agent-types.ts";
export type { AgentCapabilities, AgentPermissionMode, ClaudeModel, ClaudePermissionMode, CodexApprovalPolicy, CodexSandboxMode, EffortLevel, ModelFamily } from "./agent-models.ts";
export { cronjobRunStreamId, humanizeSchedule, parseStreamId } from "./cronjobs.ts";
export type { Cronjob, CronjobPermissionMode, CronjobRun, CronjobRunStatus, CronjobRunTrigger, Schedule } from "./cronjobs.ts";
export type { CCAvailablePlugin, CCInstalledPlugin, CCMarketplace, CCPluginScope, CCPluginsState } from "./cc-plugin-types.ts";
export type { Attachment, DiffFileSummary, DiffPayload, FilePayload, LogEntry, SubagentOrigin, TerminalCommandPayload } from "./log-types.ts";
export type { EnsureSlideReq, EnsureSlideRes, SlideDeck, SlideDeckRes, SlideFailureReason, SlideRecord } from "./slides.ts";
export { generateHexId, generateTaskId, isValidPriority, isValidStatus } from "./tasks.ts";
export type { TaskItem, TaskPriority, TaskStatus } from "./tasks.ts";
export type { InviteWire, OfficeSettings, PresenceInfo, RoomWire, SessionContext, SessionWire, UserRecord, UserRole } from "./user-types.ts";
export type { AgentSaveResponse, ClientCommand, CwdValidationResponse, ServerMessage, SettingsSaveResponse, SettingsValidationResponse } from "./wire-types.ts";

export interface UsageBucketWire {
  totalIn: number;
  cacheRead: number;
  cacheCreation: number;
  totalOut: number;
  costUSD: number;
}

export interface AgentUsageWire {
  id: string;
  name: string;
  roomId: string;
  roomName: string;
  session: UsageBucketWire;
  lifetime: UsageBucketWire;
}

export interface RoomUsageWire {
  id: string;
  name: string;
  deleted: boolean;
  session: UsageBucketWire;
  lifetime: UsageBucketWire;
}

export interface CronjobUsageWire {
  id: string;
  name: string;
  deleted: boolean;
  lifetime: UsageBucketWire;
}

export interface UsageReportWire {
  scoped: boolean;
  agents: AgentUsageWire[];
  rooms: RoomUsageWire[];
  cronjobs?: CronjobUsageWire[];
  total: {
    session: UsageBucketWire;
    lifetime: UsageBucketWire;
  };
}

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
