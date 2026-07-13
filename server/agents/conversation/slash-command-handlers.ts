import { familyDisplayLabel } from "../../../shared/types.ts";
import { listAgentSessions } from "../../persistence.ts";
import { addLogEntry, agents, emit, emitEphemeralLog, logCache, persistAll, rooms, updateState, type ManagedAgent } from "../state.ts";
import { createSession, emitLoginInstructions, replaceSession } from "../session/runtime.ts";
import { tildifyCwd } from "../session/paths.ts";
import { persistCurrentSessionTopic } from "../topic.ts";
import { renderUsageReport } from "../usage.ts";
import { handleHelpCommand } from "./slash-help.ts";
import { handleBureauDiffCommand, handleBureauEditCommand, handleBureauMessageCommand } from "./slash-bureau-tools.ts";
import { handleContextCommand } from "./slash-context.ts";
import { handleEffortCommand, handleModelCommand } from "./slash-model-effort.ts";
import { handleBureauCronjobSystemPromptCommand, handleBureauSystemPromptCommand } from "./slash-prompt-commands.ts";

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
    if (managed.messageQueue.length > 0) {
      managed.messageQueue = [];
      emit({ type: "agent_updated", agentId, changes: { queue: [] } });
    }
    persistCurrentSessionTopic(agentId, managed);
    await replaceSession(agentId, managed, newSession);
    managed.sessionId = null;
    managed.topicGenerating = false;
    managed.topicMessageCount = 0;
    managed.info.topic = null;
    managed.info.topicStale = false;
    logCache.set(agentId, []);
    emit({ type: "clear_logs", agentId } as any);
    emit({ type: "agent_updated", agentId, changes: { topic: null, topicStale: false } });
    emitEphemeralLog(agentId, "system", "Conversation cleared.");
    updateState(agentId, "idle");
    persistAll();
    return true;
  },

  async login(agentId, managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);
    emitLoginInstructions(agentId, managed);
    updateState(agentId, "waiting_for_response");
    return true;
  },

  context: handleContextCommand,

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
    let num = 1;
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
        lines.push(`  ${num}. ${label}  ${dateStr}${cwdStr}${suffix}`);
        pickable.push(s);
        num++;
      }
    }
    if (pickable.length === 0) {
      emitEphemeralLog(agentId, "system", "No other sessions to resume.");
      updateState(agentId, "waiting_for_response");
      return true;
    }
    lines.push("\nReply with a number to resume, or anything else to cancel.");
    emitEphemeralLog(agentId, "system", lines.join("\n"));
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
        const modelLabel = familyDisplayLabel(a.info.modelFamily);
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

  async bureauUsage(agentId, _managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);
    addLogEntry(agentId, "system", renderUsageReport());
    updateState(agentId, "waiting_for_response");
    return true;
  },
};
