import type { AgentInfo, SkillInfo } from "../../shared/types.ts";
import { autocompleteCommands } from "./commands.ts";
import { deduplicateSkills, discoverBundledSkills, discoverPluginSkills, discoverProjectSkills, discoverUserSkills } from "./skills-discovery.ts";
import type { ManagedAgent } from "./state.ts";

export function createManagedAgent(input: {
  info: AgentInfo;
  skillCwd: string;
  sessionId?: string | null;
  topicMessageCount?: number;
  slashCommands?: { name: string; description?: string; aliasFor?: string; autoRun?: boolean }[];
  skills?: SkillInfo[];
}): ManagedAgent {
  const slashCommands = input.slashCommands ?? autocompleteCommands();
  const skills = input.skills ?? deduplicateSkills([...discoverUserSkills(), ...discoverProjectSkills(input.skillCwd), ...discoverPluginSkills(), ...discoverBundledSkills()]);
  return {
    info: input.info,
    session: null,
    sessionId: input.sessionId ?? null,
    lastActivityAt: Date.now(),
    consumerPromise: null,
    pendingTurn: null,
    afterTurnPromise: null,
    turnCancelToken: 0,
    aborting: false,
    abortPromise: null,
    slashCommands,
    skills,
    sdkReportedCommands: [],
    thinkingStartedAt: 0,
    toolCallTimestamps: new Map(),
    topicGenerating: false,
    topicMessageCount: input.topicMessageCount ?? 0,
    pendingResume: false,
    pendingResumeSessions: [],
    pendingModelPick: false,
    pendingEffortPick: false,
    pendingPermission: null,
    ptySidecar: null,
    ptyBuffer: "",
    messageQueue: [],
    flushInProgress: false,
    recentSteers: [],
    lastWrittenEntryId: null,
    contextNudgesSent: new Set(),
    pendingContextNotices: [],
  };
}
