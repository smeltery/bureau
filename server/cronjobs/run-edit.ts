import { cronjobRunStreamId, type CronjobRun, type LogEntry } from "../../shared/types.ts";
import type { Backend, BackendSession, CreateSessionOptions, NormalizedMessage } from "../backends/types.ts";
import { findUsageAtForkRun, getRunSessionClaudeConfigDir, loadRunLog, loadRunLogWithAncestors, loadRunSessionsMap, persistRunSessionFork, updateRun } from "../persistence.ts";
import type { CronjobEvent } from "./index.ts";
import { writeLog, type ActiveRun } from "./run-events.ts";

export interface EditRunMessageDeps {
  cronRunBackend: (run: CronjobRun) => Backend;
  buildRunResumeOptions: (run: CronjobRun, resumeSessionId: string) => CreateSessionOptions;
  emitRunErrorEntry: (jobId: string, runId: string, message: string) => void;
  installResumedActive: (run: CronjobRun, session: BackendSession, sessionId: string) => ActiveRun;
  finalizeRun: (active: ActiveRun, status: CronjobRun["status"], errorReason?: string | null) => void;
  revokeRunToken: (runId: string) => void;
  emitEvent: (e: CronjobEvent) => void;
}

export async function editRunMessageWithDeps(deps: EditRunMessageDeps, run: CronjobRun, logEntryId: string, newText: string, leaf: string, username?: string): Promise<void> {
  const jobId = run.cronjobId;
  const runId = run.id;

  const oldEntries = loadRunLogWithAncestors(jobId, runId, leaf);
  const targetEntry = oldEntries.find((e) => e.id === logEntryId);
  if (!targetEntry || targetEntry.kind !== "user_message") {
    deps.emitRunErrorEntry(jobId, runId, "Cannot edit: message not found.");
    return;
  }

  const backend = deps.cronRunBackend(run);
  const leafResumeOptions = deps.buildRunResumeOptions(run, leaf);
  const leafAccess = { cwd: run.cwdSnapshot, env: leafResumeOptions.env };
  let sessionMessages: NormalizedMessage[];
  try {
    sessionMessages = await backend.getSessionMessages(leaf, run.cwdSnapshot, leafAccess);
  } catch (err: any) {
    deps.emitRunErrorEntry(jobId, runId, `Failed to load session messages: ${err.message || String(err)}`);
    return;
  }

  const targetUsername = targetEntry.metadata?.username as string | undefined;
  const targetSdkText = (targetEntry.metadata?.sdkText as string | undefined) ?? targetEntry.content;
  const prefixedContent = targetUsername ? `[${targetUsername}] ${targetSdkText}` : targetSdkText;
  const userLogEntries = oldEntries.filter((e) => e.kind === "user_message");
  let occurrenceIndex = 0;
  for (const e of userLogEntries) {
    const u = e.metadata?.username as string | undefined;
    const sdkText = (e.metadata?.sdkText as string | undefined) ?? e.content;
    const prefixed = u ? `[${u}] ${sdkText}` : sdkText;
    if (prefixed === prefixedContent) {
      if (e.id === logEntryId) break;
      occurrenceIndex++;
    }
  }

  const cronjobPromptIsFirstSdkUser = sessionMessages[0]?.role === "user";
  let matchCount = 0;
  let targetIdx = -1;
  for (let i = cronjobPromptIsFirstSdkUser ? 1 : 0; i < sessionMessages.length; i++) {
    const message = sessionMessages[i];
    if (message.role !== "user") continue;
    if (message.text === prefixedContent) {
      if (matchCount === occurrenceIndex) {
        targetIdx = i;
        break;
      }
      matchCount++;
    }
  }
  if (targetIdx <= 0) {
    deps.emitRunErrorEntry(jobId, runId, "Cannot edit: could not locate message in backend session.");
    return;
  }

  let newSessionId: string;
  let forkFromBackendSessionId = leaf;
  try {
    const forkResult = await backend.forkSessionBeforeMessage(leaf, sessionMessages[targetIdx].uuid, leafAccess);
    if (forkResult.kind === "fresh") {
      deps.emitRunErrorEntry(jobId, runId, "Cannot edit: backend returned a fresh fork without a session id.");
      return;
    }
    newSessionId = forkResult.sessionId;
    forkFromBackendSessionId = forkResult.forkedFromSessionId;
  } catch (err: any) {
    deps.emitRunErrorEntry(jobId, runId, `Fork failed: ${err.message || String(err)}`);
    return;
  }

  let session: BackendSession;
  try {
    const forkResumeOptions = deps.buildRunResumeOptions(run, newSessionId);
    session = backend.resumeSession(newSessionId, forkResumeOptions);
  } catch (err: any) {
    deps.revokeRunToken(runId);
    deps.emitRunErrorEntry(jobId, runId, `Failed to start fork: ${err.message || String(err)}`);
    return;
  }

  let forkFromSessionId = forkFromBackendSessionId;
  const leafEntries = loadRunLog(jobId, runId, leaf);
  if (!leafEntries.some((e) => e.id === logEntryId)) {
    const sessMap = loadRunSessionsMap(jobId, runId);
    let walk: string | undefined = sessMap[leaf]?.forkedFrom;
    const visited = new Set<string>([leaf]);
    while (walk && !visited.has(walk)) {
      visited.add(walk);
      const ancestorEntries = loadRunLog(jobId, runId, walk);
      if (ancestorEntries.some((e) => e.id === logEntryId)) {
        forkFromSessionId = walk;
        break;
      }
      walk = sessMap[walk]?.forkedFrom;
    }
  }

  const parentBase = findUsageAtForkRun(jobId, runId, forkFromSessionId, logEntryId);
  persistRunSessionFork(jobId, runId, newSessionId, forkFromSessionId, logEntryId, getRunSessionClaudeConfigDir(jobId, runId, leaf) ?? undefined, parentBase);
  const updatedRun = updateRun(jobId, runId, { currentSessionId: newSessionId });
  if (updatedRun) deps.emitEvent({ type: "cronjob_run_updated", run: updatedRun });

  const streamId = cronjobRunStreamId(runId);
  const parentEntries: LogEntry[] = [];
  for (const e of oldEntries) {
    if (e.id === logEntryId) break;
    parentEntries.push(e);
  }
  deps.emitEvent({ type: "clear_logs", agentId: streamId });
  for (const e of parentEntries) {
    deps.emitEvent({ type: "log_entry", entry: e });
  }

  const active = deps.installResumedActive(updatedRun ?? run, session, newSessionId);
  writeLog(active, "user_message", newText, deps.emitEvent, username ? { username } : undefined);
  const prefixedText = username ? `[${username}] ${newText}` : newText;
  (async () => {
    try {
      await session.send(prefixedText);
    } catch (err: any) {
      if (active.killed) return;
      console.error(`Cronjob run ${runId} edit-send error:`, err.message);
      writeLog(active, "error", `Failed to send edited message: ${err.message || String(err)}`, deps.emitEvent);
      try {
        session.close();
      } catch {}
      deps.finalizeRun(active, "failed", err.message || String(err));
    }
  })();
}
