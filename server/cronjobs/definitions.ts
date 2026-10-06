import { generateCronjobId, type Cronjob, type CronjobPermissionMode, type Schedule } from "../../shared/types.ts";
import { loadRuns, saveRuns, loadCronjobHistory, saveCronjobHistory, saveCronjobs } from "../persistence.ts";
import { resolveCwd } from "../agents/session/paths.ts";
import { assertModelFamilyForAgentType, validateCodexSandbox, validateCronjobPermissionMode, validateEffort, validateModelFamily } from "../agent-validators.ts";
import { getUserByName } from "../users.ts";
import { legacyScheduleRoom } from "./access.ts";
import { clampSchedule, computeNextFire } from "./schedule.ts";

export interface AddCronjobInput {
  roomId?: string | null;
  name: string;
  schedule: Schedule;
  prompt: string;
  cwd: string;
  agentType?: Cronjob["agentType"];
  modelFamily: Cronjob["modelFamily"];
  effort?: Cronjob["effort"];
  permissionMode: CronjobPermissionMode;
  codexSandbox?: Cronjob["codexSandbox"];
  username: string;
  userId?: string | null;
  device?: string;
}

export type UpdateCronjobChanges = Partial<Pick<Cronjob, "roomId" | "name" | "schedule" | "prompt" | "cwd" | "agentType" | "modelFamily" | "effort" | "permissionMode" | "codexSandbox" | "enabled">>;

export function addCronjobDefinition(cronjobs: Cronjob[], input: AddCronjobInput): Cronjob {
  const schedule = clampSchedule(input.schedule);
  const now = Date.now();
  const agentType = input.agentType ?? "claude";
  // Refuse mismatched families before any persist (same boundary as interactive agents).
  assertModelFamilyForAgentType(agentType, input.modelFamily);
  const modelFamily = validateModelFamily(agentType, input.modelFamily);
  const effort = validateEffort(agentType, modelFamily, input.effort);
  const codexSandbox = agentType === "codex" ? validateCodexSandbox(input.codexSandbox) : undefined;
  const cronjob: Cronjob = {
    id: generateCronjobId(cronjobs.map((c) => c.id)),
    name: input.name.trim() || "Untitled cron job",
    roomId: input.roomId ?? legacyScheduleRoom(input.userId ?? null, input.username),
    schedule,
    prompt: input.prompt,
    cwd: resolveCwd(input.cwd),
    agentType,
    modelFamily,
    effort,
    permissionMode: validateCronjobPermissionMode(agentType, input.permissionMode),
    ...(codexSandbox ? { codexSandbox } : {}),
    enabled: true,
    createdBy: input.username,
    userId: input.userId ?? (input.username ? (getUserByName(input.username)?.id ?? null) : null),
    username: input.username,
    device: input.device ?? null,
    createdAt: now,
    lastFireAt: null,
    nextFireAt: computeNextFire(schedule, now, now),
  };
  cronjobs.push(cronjob);
  persistCronjobDefinitions(cronjobs, cronjob);
  return cronjob;
}

export function updateCronjobDefinition(cronjobs: Cronjob[], id: string, changes: UpdateCronjobChanges): Cronjob | null {
  const idx = cronjobs.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  const prev = cronjobs[idx];
  const next: Cronjob = { ...prev };
  const agentType = changes.agentType === "claude" || changes.agentType === "codex" || changes.agentType === "opencode" ? changes.agentType : prev.agentType;
  const engineChanged = agentType !== prev.agentType;
  next.agentType = agentType;
  if (changes.roomId !== undefined && changes.roomId !== prev.roomId) {
    // Freeze historical visibility before moving the definition to another room.
    const runs = loadRuns(id).map((run) => ({
      ...run,
      roomIdSnapshot: run.roomIdSnapshot === undefined ? (prev.roomId ?? null) : run.roomIdSnapshot,
      userIdSnapshot: run.userIdSnapshot === undefined ? prev.userId : run.userIdSnapshot,
    }));
    if (runs.length) saveRuns(id, runs);
    next.roomId = changes.roomId;
  }
  if (changes.name !== undefined) next.name = changes.name.trim() || prev.name;
  if (changes.prompt !== undefined) next.prompt = changes.prompt;
  if (changes.cwd !== undefined) next.cwd = resolveCwd(changes.cwd);
  if (engineChanged || changes.modelFamily !== undefined || changes.effort !== undefined || changes.permissionMode !== undefined) {
    // Match interactive refuse: when engine or modelFamily is in the patch,
    // validate the provided family (undefined on engine-only switch → OpenCode
    // refuses; Claude/Codex may still default via validateModelFamily).
    if (engineChanged || changes.modelFamily !== undefined) {
      assertModelFamilyForAgentType(agentType, changes.modelFamily);
    }
    next.modelFamily = validateModelFamily(agentType, changes.modelFamily ?? (engineChanged ? undefined : prev.modelFamily));
    next.effort = validateEffort(agentType, next.modelFamily, changes.effort ?? (engineChanged ? undefined : prev.effort));
    next.permissionMode = validateCronjobPermissionMode(agentType, changes.permissionMode ?? (engineChanged ? undefined : prev.permissionMode));
  }
  if (agentType !== "codex") {
    if (engineChanged) delete next.codexSandbox;
  } else if (changes.codexSandbox !== undefined) {
    const sandbox = validateCodexSandbox(changes.codexSandbox);
    if (sandbox) next.codexSandbox = sandbox;
    else delete next.codexSandbox;
  }
  if (changes.enabled !== undefined) next.enabled = changes.enabled;
  if (changes.schedule !== undefined) {
    next.schedule = clampSchedule(changes.schedule);
    const anchor = next.lastFireAt ?? next.createdAt;
    next.nextFireAt = computeNextFire(next.schedule, anchor, Date.now());
  }
  cronjobs[idx] = next;
  persistCronjobDefinitions(cronjobs, next);
  return next;
}

export function deleteCronjobDefinition(cronjobs: Cronjob[], id: string): boolean {
  const idx = cronjobs.findIndex((c) => c.id === id);
  if (idx < 0) return false;
  const removed = cronjobs[idx];
  cronjobs.splice(idx, 1);
  persistCronjobDefinitions(cronjobs, removed);
  return true;
}

function persistCronjobDefinitions(cronjobs: Cronjob[], latest: Cronjob): void {
  saveCronjobs(cronjobs);
  const history = loadCronjobHistory();
  history[latest.id] = { lastName: latest.name, roomId: latest.roomId ?? null, userId: latest.userId };
  saveCronjobHistory(history);
}
