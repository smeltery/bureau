import { logMessage, logPlural, logParts, type LogParam } from "../../../shared/i18n/log-message.ts";
import { errMessage } from "../../../shared/errors.ts";
import { handleResumeCommand } from "./slash-resume.ts";
import { resetAutoHandoff } from "./auto-handoff.ts";
import { ProviderSignInRequiredError } from "../../internal-types.ts";
import { agentModelLabel } from "../../../shared/types.ts";
import { getBackupStatus } from "../../backup.ts";
import { BUREAU_DIR } from "../../persistence.ts";
import { storageReportMessage } from "../../storage/report.ts";
import { measureStorage } from "../../storage-usage.ts";
import { addLogEntry, agents, emit, emitEphemeralLog, logCache, persistAll, rooms, updateState, type ManagedAgent } from "../state.ts";
import { createSession, emitLoginInstructions, replaceSession, SessionSwappedError } from "../session/runtime.ts";
import { persistCurrentSessionTopic } from "../topic.ts";
import { usageReportMessage } from "../usage.ts";
import { usageAudienceForUser } from "../usage/report.ts";
import { getUserById } from "../../users.ts";
import { runAgentTurn } from "../../plugins/run-agent-turn.ts";
import { handleHelpCommand } from "./slash-help.ts";
import { handleBureauDiffCommand, handleBureauEditCommand, handleBureauMessageCommand } from "./slash-bureau-tools.ts";
import { handleContextCommand } from "./slash-context.ts";
import { handleEffortCommand, handleModelCommand } from "./slash-model-effort.ts";
import { handleBureauCronjobSystemPromptCommand, handleBureauSystemPromptCommand } from "./slash-prompt-commands.ts";
import { UsageCapError, usageCapMessage } from "../../usage-cap/member-usage-cap.ts";
import { holdQueueForHandoff, releaseQueueAfterHandoff } from "./control.ts";

type HandlerFn = (agentId: string, managed: ManagedAgent, args: string[], rawText: string, username?: string) => Promise<boolean>;

export const commandHandlers: Record<string, HandlerFn> = {
  async clear(agentId, managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    emitEphemeralLog(agentId, "user_message", rawText, userMeta);
    let newSession;
    try {
      newSession = createSession(managed);
    } catch (err: any) {
      emitEphemeralLog(agentId, "error", logMessage("logs.command.clearFailed", { error: errMessage(err) }));
      updateState(agentId, "error");
      return true;
    }
    managed.pendingResume = false;
    managed.pendingResumeSessions = [];
    managed.pendingModelPick = false;
    managed.pendingEffortPick = false;
    managed.pendingCronjobPick = false;
    const dropped = managed.messageQueue.length;
    if (dropped > 0) {
      managed.messageQueue = [];
      emit({ type: "agent_updated", agentId, changes: { queue: [] } });
    }
    persistCurrentSessionTopic(agentId, managed);
    await replaceSession(agentId, managed, newSession);
    managed.sessionId = null;
    managed.topicGenerating = false;
    managed.topicMessageCount = 0;
    managed.contextNudgesSent.clear();
    managed.firedUiThresholds.clear();
    managed.pendingContextNotices = [];
    managed.wakeNotice = null;
    managed.settingsNotice = null;
    resetAutoHandoff(managed);
    managed.info.topic = null;
    managed.info.topicStale = false;
    managed.info.contextUsage = null;
    logCache.set(agentId, []);
    emit({ type: "clear_logs", agentId });
    emit({ type: "agent_updated", agentId, changes: { topic: null, topicStale: false, contextUsage: null } });
    emitEphemeralLog(agentId, "system", dropped > 0 ? logPlural("logs.command.clearedQueue", dropped) : logMessage("logs.command.cleared"));
    updateState(agentId, "idle");
    persistAll();
    return true;
  },

  async login(agentId, managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);
    await emitLoginInstructions(agentId, managed);
    updateState(agentId, "waiting_for_response");
    return true;
  },

  context: handleContextCommand,

  async handoff(agentId, managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);
    const prompt = [
      "Prepare a handoff prompt for a fresh session of yourself.",
      "",
      "Include:",
      "- current objective and latest state",
      "- important decisions and constraints",
      "- changed files or commands already run",
      "- exact next steps",
      "- risks or open questions",
      "",
      "Keep it concise but sufficient. End by asking the boss to approve the reset by running:",
      "`/handoff-apply <your handoff prompt>`",
      "",
      "Do not clear anything yourself.",
    ].join("\n");
    try {
      await runAgentTurn({
        managed,
        visibleText: rawText,
        originalText: prompt,
        sdkText: username ? `[${username}] ${prompt}` : prompt,
        username: username ?? null,
        origin: "skill",
        humanInput: true,
      });
    } catch (err: any) {
      if (err instanceof SessionSwappedError || err instanceof ProviderSignInRequiredError) return true;
      if (err instanceof UsageCapError) {
        addLogEntry(agentId, "error", usageCapMessage(err));
        updateState(agentId, "waiting_for_response");
        return true;
      }
      addLogEntry(agentId, "error", logMessage("logs.command.handoffFailed", { error: errMessage(err) }));
      updateState(agentId, "error");
    }
    return true;
  },

  async handoffApply(agentId, managed, _args, rawText, username) {
    const handoffPrompt = rawText.replace(/^\/handoff-apply\s*/u, "").trim();
    if (!handoffPrompt) {
      emitEphemeralLog(agentId, "user_message", rawText, username ? { username } : undefined);
      emitEphemeralLog(agentId, "system", logMessage("logs.command.handoffUsage", { command: "/handoff-apply <handoff prompt>" }));
      updateState(agentId, "waiting_for_response");
      return true;
    }
    let newSession;
    try {
      newSession = createSession(managed);
    } catch (err: any) {
      emitEphemeralLog(agentId, "error", logMessage("logs.command.handoffStartFailed", { error: errMessage(err) }));
      updateState(agentId, "error");
      return true;
    }
    managed.pendingResume = false;
    managed.pendingResumeSessions = [];
    managed.pendingModelPick = false;
    managed.pendingEffortPick = false;
    managed.pendingCronjobPick = false;
    holdQueueForHandoff(managed);
    persistCurrentSessionTopic(agentId, managed);
    await replaceSession(agentId, managed, newSession).catch((err) => (releaseQueueAfterHandoff(agentId, managed), Promise.reject(err)));
    managed.sessionId = null;
    managed.topicGenerating = false;
    managed.topicMessageCount = 0;
    managed.contextNudgesSent.clear();
    managed.firedUiThresholds.clear();
    managed.pendingContextNotices = [];
    managed.wakeNotice = null;
    managed.settingsNotice = null;
    resetAutoHandoff(managed);
    managed.info.topic = null;
    managed.info.topicStale = false;
    managed.info.contextUsage = null;
    logCache.set(agentId, []);
    emit({ type: "clear_logs", agentId });
    emit({ type: "agent_updated", agentId, changes: { topic: null, topicStale: false, contextUsage: null } });
    addLogEntry(agentId, "system", logMessage("logs.command.handoffApproved"));
    addLogEntry(agentId, "user_message", handoffPrompt, username ? { username } : undefined);
    persistAll();
    try {
      await runAgentTurn({
        managed,
        visibleText: handoffPrompt,
        originalText: handoffPrompt,
        sdkText: username ? `[${username}] ${handoffPrompt}` : handoffPrompt,
        username: username ?? null,
        origin: "user",
        humanInput: true,
      });
    } catch (err: any) {
      if (err instanceof SessionSwappedError || err instanceof ProviderSignInRequiredError) return true;
      if (err instanceof UsageCapError) {
        addLogEntry(agentId, "error", usageCapMessage(err));
        updateState(agentId, "waiting_for_response");
        return true;
      }
      addLogEntry(agentId, "error", logMessage("logs.command.handoffRestartFailed", { error: errMessage(err) }));
      updateState(agentId, "error");
    } finally {
      releaseQueueAfterHandoff(agentId, managed);
    }
    return true;
  },

  async help(agentId, managed, _args, rawText, username) {
    return handleHelpCommand(agentId, managed, rawText, username);
  },

  resume: handleResumeCommand,

  model: handleModelCommand,
  effort: handleEffortCommand,

  async bureauAllHands(agentId, _managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);
    const roomMap = new Map<number, ManagedAgent[]>();
    for (const a of agents.values()) {
      const room = a.info.room;
      if (!roomMap.has(room)) roomMap.set(room, []);
      roomMap.get(room)!.push(a);
    }

    const lines: LogParam[] = [];
    for (const room of [...roomMap.keys()].sort((a, b) => a - b)) {
      const roomAgents = roomMap.get(room)!.sort((a, b) => a.info.desk - b.info.desk);
      lines.push(logMessage("logs.command.rosterRoom", { room: room + 1 }));
      lines.push("");

      for (const a of roomAgents) {
        const selfTag = a.info.id === agentId ? logMessage("logs.command.rosterSelf") : "";
        const modelLabel = agentModelLabel(a.info.agentType, a.info.modelFamily, a.info.claudeModelOverrides);
        const topic = a.info.topic;
        const hasTopic = topic && topic !== "...";
        const header = logMessage("logs.command.rosterAgent", { name: a.info.name, desk: a.info.desk + 1, self: selfTag, model: modelLabel, cwd: a.info.cwd });
        if (hasTopic) {
          lines.push(header);
          lines.push(logMessage("logs.command.rosterTopic", { topic }));
        } else {
          lines.push({ parts: ['<span style="color: var(--text-dim)">', header, "</span>"] });
        }
        lines.push("");
      }
    }

    lines.push(logMessage("logs.command.rosterTip"));

    addLogEntry(agentId, "system", logParts(lines.flatMap((line, index) => (index === 0 ? [line] : ["\n", line]))));
    updateState(agentId, "waiting_for_response");
    return true;
  },

  bureauSystemPrompt: handleBureauSystemPromptCommand,
  bureauCronjobSystemPrompt: handleBureauCronjobSystemPromptCommand,
  bureauEdit: handleBureauEditCommand,
  bureauMessage: handleBureauMessageCommand,
  bureauDiff: handleBureauDiffCommand,

  async usage(agentId, _managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);
    addLogEntry(agentId, "system", logMessage("logs.command.subscriptionUsage"));
    addLogEntry(agentId, "terminal-command", "claude", undefined, undefined, { terminal: { command: "claude" } });
    addLogEntry(agentId, "terminal-command", "codex", undefined, undefined, { terminal: { command: "codex" } });
    updateState(agentId, "waiting_for_response");
    return true;
  },

  async bureauUsage(agentId, managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);
    addLogEntry(agentId, "system", usageReportMessage(usageAudienceForUser(managed.info.userId ? getUserById(managed.info.userId) : null)));
    updateState(agentId, "waiting_for_response");
    return true;
  },

  async bureauStorage(agentId, managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);

    const user = managed.info.userId ? getUserById(managed.info.userId) : null;
    if (user?.role !== "owner") {
      addLogEntry(agentId, "system", logMessage("logs.command.storageOwner"));
      updateState(agentId, "waiting_for_response");
      return true;
    }

    const backup = getBackupStatus();
    addLogEntry(agentId, "system", storageReportMessage(measureStorage({ stateRoot: BUREAU_DIR, backupDir: backup.backupDir })));
    updateState(agentId, "waiting_for_response");
    return true;
  },
};
