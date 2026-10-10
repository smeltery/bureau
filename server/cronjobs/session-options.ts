import { cronjobRunStreamId, type Cronjob, type CronjobRun } from "../../shared/types.ts";
import { ensureRunSessionClaudeConfigDir, getRunSessionClaudeConfigDir, readEnvFile, rollRunSessionUsageOnResume } from "../persistence.ts";
import { claudeConfigRoot } from "../agents/session/paths.ts";
import { officeConfig } from "../agents/state.ts";
import { openCodeEnvironmentId } from "../backends/opencode/profiles/identity.ts";
import { getBackend } from "../backends/index.ts";
import type { Backend, CreateSessionOptions } from "../backends/types.ts";
import { getUserById } from "../users.ts";
import { buildCronjobMemoryPrompt } from "./system-prompt.ts";

export function buildCronjobEnv(userId?: string | null): { [key: string]: string | undefined } | undefined {
  const officeEnvFile = officeConfig.envFile;
  const userEnvFile = userId ? (getUserById(userId)?.envFile ?? null) : null;
  if (!officeEnvFile && !userEnvFile) return undefined;
  const merged: { [key: string]: string | undefined } = { ...process.env };
  if (officeEnvFile) Object.assign(merged, readEnvFile(officeEnvFile));
  if (userEnvFile) Object.assign(merged, readEnvFile(userEnvFile));
  return merged;
}

export function withRunTokenEnv(env: { [key: string]: string | undefined } | undefined, token: string): { [key: string]: string | undefined } {
  return { ...(env ?? process.env), BUREAU_AGENT_TOKEN: token };
}

export function cronRunBackend(run: CronjobRun): Backend {
  return getBackend(run.agentTypeSnapshot ?? "claude");
}

export function cronjobBackend(job: Cronjob): Backend {
  return getBackend(job.agentType);
}

export function buildRunSessionOptions({
  job,
  jobId,
  runId,
  env,
  buildSystemPrompt,
}: {
  job: Cronjob;
  jobId: string;
  runId: string;
  env: { [key: string]: string | undefined } | undefined;
  buildSystemPrompt: (cronjob: Cronjob, jobId: string, runId: string, memoryPrompt?: string | null) => string;
}): CreateSessionOptions {
  const systemPrompt = buildSystemPrompt(job, jobId, runId, buildCronjobMemoryPrompt());
  return {
    agentId: cronjobRunStreamId(runId),
    environmentId: openCodeEnvironmentId(job.userId),
    resolveEnv: () => buildCronjobEnv(job.userId),
    modelFamily: job.modelFamily,
    effort: job.effort,
    permissionMode: job.permissionMode,
    sandbox: job.codexSandbox,
    env,
    systemPrompt,
    cwd: job.cwd,
  };
}

export function buildRunResumeOptions({
  run,
  resumeSessionId,
  cronjobs,
  runToken,
  buildSystemPrompt,
}: {
  run: CronjobRun;
  resumeSessionId: string;
  cronjobs: Cronjob[];
  runToken: string;
  buildSystemPrompt: (cronjob: Cronjob, jobId: string, runId: string, memoryPrompt?: string | null) => string;
}): CreateSessionOptions {
  // Roll the current-run usage into priorRunsUsage so the SDK's per-process
  // cost counter resetting to zero (which it does on every resume) doesn't
  // wipe lifetime accounting. Mirrors agent-manager's createSession.
  rollRunSessionUsageOnResume(run.cronjobId, run.id, resumeSessionId);
  // Re-pass the system prompt when the cronjob still exists so resumed runs
  // pick up any office/cronjobs prompt edits. For deleted cronjobs, use an
  // empty append instead of synthesizing a partial prompt.
  const job = cronjobs.find((c) => c.id === run.cronjobId);
  const userId = run.userIdSnapshot !== undefined ? run.userIdSnapshot : (job?.userId ?? null);
  const baseEnv = buildCronjobEnv(userId);
  let env = withRunTokenEnv(baseEnv, runToken);
  if ((run.agentTypeSnapshot ?? "claude") === "claude") {
    const pinnedRoot = getRunSessionClaudeConfigDir(run.cronjobId, run.id, resumeSessionId);
    if (pinnedRoot) env = { ...env, CLAUDE_CONFIG_DIR: pinnedRoot };
    else ensureRunSessionClaudeConfigDir(run.cronjobId, run.id, resumeSessionId, claudeConfigRoot(env));
  }
  return {
    agentId: cronjobRunStreamId(run.id),
    environmentId: openCodeEnvironmentId(userId),
    resolveEnv: () => buildCronjobEnv(userId),
    modelFamily: run.modelFamilySnapshot,
    effort: run.effortSnapshot,
    permissionMode: run.permissionModeSnapshot,
    sandbox: run.codexSandboxSnapshot,
    env,
    systemPrompt: job ? buildSystemPrompt({ ...job, agentType: run.agentTypeSnapshot ?? "claude" }, run.cronjobId, run.id, buildCronjobMemoryPrompt()) : "",
    cwd: run.cwdSnapshot,
  };
}
