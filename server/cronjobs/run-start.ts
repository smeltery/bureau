import { cronjobRunStreamId, generateCronjobRunId, type Cronjob, type CronjobRun } from "../../shared/types.ts";
import type { BackendSession, CreateSessionOptions } from "../backends/types.ts";
import type { CronjobEvent } from "./index.ts";
import { writeLog, type ActiveRun } from "./run-events.ts";
import type { RunLifecycleDeps } from "./run-lifecycle.ts";
import { claudeConfigRoot } from "../agents/session/paths.ts";

export interface RunStartDeps {
  activeRuns: Map<string, ActiveRun>;
  appendRun(jobId: string, run: CronjobRun): void;
  updateRun(jobId: string, runId: string, patch: Partial<CronjobRun>): CronjobRun | null;
  saveCronjobs(cronjobs: Cronjob[]): void;
  getCronjobs(): Cronjob[];
  emitEvent(event: CronjobEvent): void;
  validateCwd(cwd: string): void;
  buildEnv(userId?: string | null): { [key: string]: string | undefined } | undefined;
  mintRunToken(jobId: string, runId: string, userId: string | null): string;
  revokeRunToken(runId: string): void;
  withRunTokenEnv(env: { [key: string]: string | undefined } | undefined, token: string): { [key: string]: string | undefined };
  buildRunSessionOptions(job: Cronjob, jobId: string, runId: string, env: { [key: string]: string | undefined } | undefined): CreateSessionOptions;
  createSession(job: Cronjob, opts: CreateSessionOptions): BackendSession;
  runConsumer(active: ActiveRun): Promise<void>;
  startRunHardTimeout(deps: RunLifecycleDeps, active: ActiveRun): void;
  lifecycleDeps(): RunLifecycleDeps;
  finalizeRun(active: ActiveRun, status: CronjobRun["status"], errorReason?: string | null): void;
  computeNextFire(schedule: Cronjob["schedule"], anchor: number, now?: number): number | null;
}

export function fireCronjobRunWithDeps(deps: RunStartDeps, job: Cronjob, trigger: CronjobRun["trigger"], triggeredBy?: string, webhook?: CronjobRun["webhook"]): CronjobRun | null {
  const jobId = job.id;

  // Validate cwd before spawning so a moved directory surfaces as a failed
  // run rather than an opaque SDK exit.
  let cwdValid = true;
  let cwdError: string | null = null;
  let env: { [key: string]: string | undefined } | undefined;
  try {
    deps.validateCwd(job.cwd);
    env = deps.buildEnv(job.userId);
  } catch (err: any) {
    cwdValid = false;
    cwdError = err.message || "Invalid cronjob environment";
  }

  const runId = generateCronjobRunId();
  const placeholderSessionId = `pending-${runId}`;
  const now = Date.now();
  const run: CronjobRun = {
    id: runId,
    cronjobId: jobId,
    cronjobName: job.name,
    roomIdSnapshot: job.roomId ?? null,
    userIdSnapshot: job.userId,
    trigger,
    ...(webhook ? { webhook } : {}),
    status: cwdValid ? "running" : "failed",
    startedAt: now,
    endedAt: cwdValid ? null : now,
    errorReason: cwdError,
    promptSnapshot: job.prompt,
    agentTypeSnapshot: job.agentType,
    modelFamilySnapshot: job.modelFamily,
    effortSnapshot: job.effort,
    cwdSnapshot: job.cwd,
    permissionModeSnapshot: job.permissionMode,
    ...(job.codexSandbox ? { codexSandboxSnapshot: job.codexSandbox } : {}),
    rootSessionId: placeholderSessionId,
    currentSessionId: placeholderSessionId,
    previewText: cwdError ?? "",
    ...(triggeredBy ? { triggeredBy } : {}),
  };
  deps.appendRun(jobId, run);
  deps.emitEvent({ type: "cronjob_run_updated", run });

  if (!cwdValid) {
    if (trigger === "scheduled") {
      job.lastFireAt = now;
      job.nextFireAt = deps.computeNextFire(job.schedule, now, now);
      deps.saveCronjobs(deps.getCronjobs());
      deps.emitEvent({ type: "cronjob_updated", cronjob: job });
    }
    return run;
  }

  const runToken = deps.mintRunToken(jobId, runId, job.userId ?? null);
  const opts = deps.buildRunSessionOptions(job, jobId, runId, deps.withRunTokenEnv(env, runToken));
  let session: BackendSession;
  try {
    session = deps.createSession(job, opts);
  } catch (err: any) {
    deps.revokeRunToken(runId);
    const updated = deps.updateRun(jobId, runId, {
      status: "failed",
      endedAt: Date.now(),
      errorReason: `Failed to create session: ${err.message || String(err)}`,
    });
    if (updated) deps.emitEvent({ type: "cronjob_run_updated", run: updated });
    return updated ?? run;
  }

  const active: ActiveRun = {
    jobId,
    runId,
    streamId: cronjobRunStreamId(runId),
    session,
    sessionId: null,
    rootSessionId: placeholderSessionId,
    consumerPromise: Promise.resolve(),
    hardTimeoutTimer: null,
    lastWrittenEntryId: null,
    lastAssistantText: "",
    trigger,
    killed: false,
    pendingEntries: [],
    isResume: false,
    launchedClaudeConfigDir: job.agentType === "claude" ? claudeConfigRoot(opts.env) : undefined,
  };
  deps.activeRuns.set(runId, active);
  active.consumerPromise = deps.runConsumer(active);
  deps.startRunHardTimeout(deps.lifecycleDeps(), active);

  void sendInitialPrompt(deps, active, session, job.prompt);
  return run;
}

export function recordSkippedRunWithDeps(deps: Pick<RunStartDeps, "appendRun" | "emitEvent">, job: Cronjob): CronjobRun {
  const runId = generateCronjobRunId();
  const now = Date.now();
  const run: CronjobRun = {
    id: runId,
    cronjobId: job.id,
    cronjobName: job.name,
    roomIdSnapshot: job.roomId ?? null,
    userIdSnapshot: job.userId,
    trigger: "scheduled",
    status: "skipped",
    startedAt: now,
    endedAt: now,
    errorReason: "previous scheduled run still in flight",
    promptSnapshot: job.prompt,
    agentTypeSnapshot: job.agentType,
    modelFamilySnapshot: job.modelFamily,
    effortSnapshot: job.effort,
    cwdSnapshot: job.cwd,
    permissionModeSnapshot: job.permissionMode,
    ...(job.codexSandbox ? { codexSandboxSnapshot: job.codexSandbox } : {}),
    rootSessionId: `skipped-${runId}`,
    previewText: "",
  };
  deps.appendRun(job.id, run);
  deps.emitEvent({ type: "cronjob_run_updated", run });
  return run;
}

async function sendInitialPrompt(deps: RunStartDeps, active: ActiveRun, session: BackendSession, prompt: string): Promise<void> {
  try {
    await session.send(prompt);
  } catch (err: any) {
    if (active.killed) return;
    console.error(`Cronjob run ${active.runId} input error:`, err.message);
    writeLog(active, "error", `Failed to send prompt: ${err.message || String(err)}`, deps.emitEvent);
    try {
      session.close();
    } catch {}
    deps.finalizeRun(active, "failed", err.message || String(err));
  }
}
