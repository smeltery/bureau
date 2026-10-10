import { ProviderSignInRequiredError } from "../../internal-types.ts";
import { familyDisplayLabel } from "../../../shared/types.ts";
import { getBackupStatus } from "../../backup.ts";
import { listAgentSessions } from "../../persistence.ts";
import { BUREAU_DIR } from "../../persistence/paths.ts";
import { renderStorageReport } from "../../storage/report.ts";
import { measureStorage } from "../../storage-usage.ts";
import { addLogEntry, agents, emit, emitEphemeralLog, logCache, persistAll, rooms, updateState, type ManagedAgent } from "../state.ts";
import { createSession, emitLoginInstructions, replaceSession, SessionSwappedError } from "../session/runtime.ts";
import { tildifyCwd } from "../session/paths.ts";
import { persistCurrentSessionTopic } from "../topic.ts";
import { renderUsageReport } from "../usage.ts";
import { usageAudienceForUser } from "../usage/report.ts";
import { getUserById } from "../../users.ts";
import { runAgentTurn } from "../../plugins/run-agent-turn.ts";
import { handleHelpCommand } from "./slash-help.ts";
import { handleBureauDiffCommand, handleBureauEditCommand, handleBureauMessageCommand } from "./slash-bureau-tools.ts";
import { handleContextCommand } from "./slash-context.ts";
import { handleEffortCommand, handleModelCommand } from "./slash-model-effort.ts";
import { handleBureauCronjobSystemPromptCommand, handleBureauSystemPromptCommand } from "./slash-prompt-commands.ts";
import { UsageCapError, usageCapText } from "../../usage-cap/member-usage-cap.ts";
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
      emitEphemeralLog(agentId, "error", `Failed to clear conversation: ${err.message}`);
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
    managed.info.topic = null;
    managed.info.topicStale = false;
    managed.info.contextUsage = null;
    logCache.set(agentId, []);
    emit({ type: "clear_logs", agentId });
    emit({ type: "agent_updated", agentId, changes: { topic: null, topicStale: false, contextUsage: null } });
    emitEphemeralLog(agentId, "system", dropped > 0 ? `Conversation cleared. Dropped ${dropped} queued message${dropped === 1 ? "" : "s"}.` : "Conversation cleared.");
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
        addLogEntry(agentId, "error", usageCapText(err));
        updateState(agentId, "waiting_for_response");
        return true;
      }
      addLogEntry(agentId, "error", `Handoff error: ${err.message}`);
      updateState(agentId, "error");
    }
    return true;
  },

  async handoffApply(agentId, managed, _args, rawText, username) {
    const handoffPrompt = rawText.replace(/^\/handoff-apply\s*/u, "").trim();
    if (!handoffPrompt) {
      emitEphemeralLog(agentId, "user_message", rawText, username ? { username } : undefined);
      emitEphemeralLog(agentId, "system", "Usage: `/handoff-apply <handoff prompt>`");
      updateState(agentId, "waiting_for_response");
      return true;
    }
    let newSession;
    try {
      newSession = createSession(managed);
    } catch (err: any) {
      emitEphemeralLog(agentId, "error", `Failed to start handoff session: ${err.message}`);
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
    managed.info.topic = null;
    managed.info.topicStale = false;
    managed.info.contextUsage = null;
    logCache.set(agentId, []);
    emit({ type: "clear_logs", agentId });
    emit({ type: "agent_updated", agentId, changes: { topic: null, topicStale: false, contextUsage: null } });
    addLogEntry(agentId, "system", "Handoff approved. Starting fresh from the handoff prompt.");
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
        addLogEntry(agentId, "error", usageCapText(err));
        updateState(agentId, "waiting_for_response");
        return true;
      }
      addLogEntry(agentId, "error", `Handoff restart error: ${err.message}`);
      updateState(agentId, "error");
    } finally {
      releaseQueueAfterHandoff(agentId, managed);
    }
    return true;
  },

  async help(agentId, managed, _args, rawText, username) {
    return handleHelpCommand(agentId, managed, rawText, username);
  },

  async resume(agentId, managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    emitEphemeralLog(agentId, "user_message", rawText, userMeta);
    const sessions = listAgentSessions(agentId);
    if (sessions.length === 0) {
      emitEphemeralLog(agentId, "system", "No previous sessions found.");
      updateState(agentId, "waiting_for_response");
      return true;
    }
    const lines: string[] = ["Resume a past conversation:\n"];
    const pickable: typeof sessions = [];
    for (const s of sessions.slice(0, 20)) {
      const date = new Date(s.lastModified);
      const dateStr = date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
      const rawLabel = s.topic || s.sessionId.slice(0, 8) + "...";
      const label = s.forked ? `↳ ${rawLabel}` : rawLabel;
      const suffix = s.branched ? "  (branched)" : "";
      const cwdStr = s.cwd ? `  ${tildifyCwd(s.cwd)}` : "";
      if (s.sessionId === managed.sessionId) {
        lines.push(`  \u25cf ${label}  ${dateStr}${cwdStr}  (current)`);
      } else {
        lines.push(`  ${pickable.length + 1}. ${label}  ${dateStr}${cwdStr}${suffix}`);
        pickable.push(s);
      }
    }
    if (pickable.length === 0) {
      emitEphemeralLog(agentId, "system", "No other sessions to resume.");
      updateState(agentId, "waiting_for_response");
      return true;
    }
    const instruction = "\nReply with a number to resume, or anything else to cancel.";
    lines.push(instruction);
    emitEphemeralLog(agentId, "system", lines.join("\n"), {
      choicePrompt: {
        kind: "resume",
        title: "Resume a past conversation",
        instruction: instruction.trim(),
        choices: pickable.map((session) => {
          const date = new Date(session.lastModified);
          const dateStr = date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
          const label = session.topic || `${session.sessionId.slice(0, 8)}...`;
          const details = [dateStr, session.cwd ? tildifyCwd(session.cwd) : null, session.branched ? "branched" : null].filter(Boolean).join("  ");
          return { value: session.sessionId, label, description: details || undefined };
        }),
      },
    });
    managed.pendingResume = true;
    managed.pendingResumeSessions = pickable;
    updateState(agentId, "waiting_for_response");
    return true;
  },

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

    const lines: string[] = [];
    for (const room of [...roomMap.keys()].sort((a, b) => a - b)) {
      const roomAgents = roomMap.get(room)!.sort((a, b) => a.info.desk - b.info.desk);
      lines.push(`**=== Room ${room + 1} ===**`);
      lines.push("");

      for (const a of roomAgents) {
        const selfTag = a.info.id === agentId ? "  **(me)**" : "";
        const modelLabel = familyDisplayLabel(a.info.modelFamily, a.info.claudeModelOverrides);
        const topic = a.info.topic;
        const hasTopic = topic && topic !== "...";
        const header = `**${a.info.name}** (desk ${a.info.desk + 1})${selfTag} — ${modelLabel} — \`${a.info.cwd}\``;
        if (hasTopic) {
          lines.push(header);
          lines.push(`  Topic: ${topic}`);
        } else {
          lines.push(`<span style="color: var(--text-dim)">${header}</span>`);
        }
        lines.push("");
      }
    }

    lines.push("Ask your agent if you'd like to know more about any agent or conversation.");

    addLogEntry(agentId, "system", lines.join("\n"));
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
    addLogEntry(
      agentId,
      "system",
      [
        "**Subscription plan limits aren't shown here.**",
        "",
        "To check your Claude or ChatGPT subscription quota, open the embedded terminal and:",
        "",
        "- launch `claude`, then type `/usage`",
        "- launch `codex`, then type `/status`",
        "",
        "For Bureau office-level token spend (per-agent / per-room / per-cron-job), see `/bureau-usage`.",
      ].join("\n"),
    );
    addLogEntry(agentId, "terminal-command", "claude", undefined, undefined, { terminal: { command: "claude" } });
    addLogEntry(agentId, "terminal-command", "codex", undefined, undefined, { terminal: { command: "codex" } });
    updateState(agentId, "waiting_for_response");
    return true;
  },

  async bureauUsage(agentId, managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);
    addLogEntry(agentId, "system", renderUsageReport(usageAudienceForUser(managed.info.userId ? getUserById(managed.info.userId) : null)));
    updateState(agentId, "waiting_for_response");
    return true;
  },

  async bureauStorage(agentId, managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);

    const user = managed.info.userId ? getUserById(managed.info.userId) : null;
    if (user?.role !== "owner") {
      addLogEntry(agentId, "system", "Storage usage is only available to office owners.");
      updateState(agentId, "waiting_for_response");
      return true;
    }

    const backup = getBackupStatus();
    addLogEntry(agentId, "system", renderStorageReport(measureStorage({ stateRoot: BUREAU_DIR, backupDir: backup.backupDir })));
    updateState(agentId, "waiting_for_response");
    return true;
  },
};
