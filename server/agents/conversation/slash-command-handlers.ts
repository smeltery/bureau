import { MODEL_FAMILIES, EFFORT_LEVELS, familyDisplayLabel, effortDisplayLabel } from "../../../shared/types.ts";
import { computeBureauDiff, resolveDiffCwd } from "../../bureau-diff.ts";
import { resolveEditorPath, openFile as openEditorFile } from "../../file-editor.ts";
import { listAgentSessions } from "../../persistence.ts";
import { addLogEntry, agents, emit, emitEphemeralLog, logCache, persistAll, rooms, updateState, type ManagedAgent } from "../state.ts";
import { enqueueMessage } from "./send.ts";
import { createSession, emitLoginInstructions, replaceSession } from "../session/runtime.ts";
import { tildifyCwd } from "../session/paths.ts";
import { persistCurrentSessionTopic } from "../topic.ts";
import { renderUsageReport } from "../usage.ts";
import { handleHelpCommand } from "./slash-help.ts";
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

  async context(agentId, managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);
    if (!managed.session) {
      addLogEntry(agentId, "system", "No active session.");
      return true;
    }
    try {
      const query = (managed.session as any).query;
      if (!query?.getContextUsage) {
        addLogEntry(agentId, "system", "Context usage not available for this session.");
        return true;
      }
      const ctx = await query.getContextUsage();
      const lines: string[] = [];

      const pct = Math.round(ctx.percentage);
      const barLen = 30;
      const filled = Math.round((barLen * ctx.percentage) / 100);
      const bar = "\u2588".repeat(filled) + "\u2591".repeat(barLen - filled);
      lines.push(`**${ctx.model}** \u2014 ${ctx.totalTokens.toLocaleString()} / ${ctx.maxTokens.toLocaleString()} tokens (${pct}%)`);
      lines.push(`\`${bar}\``);

      if (ctx.categories?.length > 0) {
        lines.push("");
        for (const cat of ctx.categories) {
          if (cat.tokens > 0) {
            const catPct = ((cat.tokens / ctx.maxTokens) * 100).toFixed(1);
            lines.push(`  ${cat.name}: ${cat.tokens.toLocaleString()} tokens (${catPct}%)`);
          }
        }
      }

      if (ctx.memoryFiles?.length > 0) {
        lines.push("\n**Memory files:**");
        for (const f of ctx.memoryFiles) {
          lines.push(`  ${f.path} (${f.tokens.toLocaleString()} tokens)`);
        }
      }

      if (ctx.systemPromptSections?.length > 0) {
        lines.push("\n**System prompt:**");
        for (const s of ctx.systemPromptSections) {
          lines.push(`  ${s.name}: ${s.tokens.toLocaleString()} tokens`);
        }
      }

      if (ctx.isAutoCompactEnabled && ctx.autoCompactThreshold) {
        const compactPct = Math.round((ctx.autoCompactThreshold / ctx.maxTokens) * 100);
        lines.push(`\nAuto-compact at ${compactPct}% (${ctx.autoCompactThreshold.toLocaleString()} tokens)`);
      }

      addLogEntry(agentId, "system", lines.join("\n"));
    } catch (err: any) {
      addLogEntry(agentId, "system", `Failed to get context usage: ${err.message}`);
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

  async model(agentId, managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    emitEphemeralLog(agentId, "user_message", rawText, userMeta);
    const currentLabel = familyDisplayLabel(managed.info.modelFamily);
    const lines: string[] = [`Switch model (current: **${currentLabel}**):\n`];
    for (let i = 0; i < MODEL_FAMILIES.length; i++) {
      const m = MODEL_FAMILIES[i];
      const marker = m.family === managed.info.modelFamily ? " (current)" : "";
      lines.push(`  ${i + 1}. ${familyDisplayLabel(m.family)}${marker}`);
    }
    lines.push("\nReply with a number to switch, or anything else to cancel.");
    emitEphemeralLog(agentId, "system", lines.join("\n"));
    managed.pendingModelPick = true;
    updateState(agentId, "waiting_for_response");
    return true;
  },

  async effort(agentId, managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    emitEphemeralLog(agentId, "user_message", rawText, userMeta);
    const currentLabel = effortDisplayLabel(managed.info.effort);
    const lines: string[] = [`Switch thinking effort (current: **${currentLabel}**):\n`];
    for (let i = 0; i < EFFORT_LEVELS.length; i++) {
      const e = EFFORT_LEVELS[i];
      const marker = e.level === managed.info.effort ? " (current)" : "";
      lines.push(`  ${i + 1}. ${effortDisplayLabel(e.level)}${marker}`);
    }
    lines.push("\nReply with a number to switch, or anything else to cancel.");
    emitEphemeralLog(agentId, "system", lines.join("\n"));
    managed.pendingEffortPick = true;
    updateState(agentId, "waiting_for_response");
    return true;
  },

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

  async bureauEdit(agentId, managed, args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);

    const rawPath = args[0];
    if (!rawPath) {
      addLogEntry(agentId, "system", `Usage: \`/bureau-edit <path>\`. Path can be relative (resolves against ${managed.info.cwd}), absolute, or \`~/...\`.`);
      updateState(agentId, "waiting_for_response");
      return true;
    }
    const resolved = resolveEditorPath(rawPath, managed.info.cwd);
    if (resolved.kind === "bad_path") {
      addLogEntry(agentId, "system", `Empty path.`);
      updateState(agentId, "waiting_for_response");
      return true;
    }
    const probe = openEditorFile(resolved.path);
    if (probe.kind === "not_found") {
      addLogEntry(agentId, "system", `\`${resolved.path}\` does not exist.`);
    } else if (probe.kind === "not_file") {
      addLogEntry(agentId, "system", `\`${resolved.path}\` is not a file.`);
    } else if (probe.kind === "binary") {
      addLogEntry(agentId, "system", `\`${resolved.path}\` is a binary file — the editor panel only supports text.`);
    } else if (probe.kind === "too_large") {
      addLogEntry(agentId, "system", `\`${resolved.path}\` is ${(probe.size / 1024).toFixed(1)} KB — too large for the editor panel (1 MB limit).`);
    } else if (probe.kind === "io_error") {
      addLogEntry(agentId, "system", `Failed to open \`${resolved.path}\`: ${probe.message}`);
    } else {
      addLogEntry(agentId, "edit-request", resolved.path, undefined, undefined, { file: { path: resolved.path } });
    }
    updateState(agentId, "waiting_for_response");
    return true;
  },

  async bureauMessage(agentId, managed, args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);

    const targetArg = args[0];
    const text = args.slice(1).join(" ").trim();
    const others = [...agents.values()].filter((a) => a.info.id !== agentId);

    if (!targetArg || !text) {
      const lines = ["Usage: `/bureau-message <agent-name-or-id> <message>`"];
      if (others.length === 0) {
        lines.push("\nNo other agents to message.");
      } else {
        lines.push("\nOther agents:");
        for (const a of others) lines.push(`  **${a.info.name}**  \`${a.info.id}\``);
      }
      addLogEntry(agentId, "system", lines.join("\n"));
      updateState(agentId, "waiting_for_response");
      return true;
    }

    const self = managed.info;
    if (targetArg === self.id || targetArg.toLocaleLowerCase() === self.name.toLocaleLowerCase()) {
      addLogEntry(agentId, "system", "You can't message yourself.");
      updateState(agentId, "waiting_for_response");
      return true;
    }

    const byId = others.find((a) => a.info.id === targetArg);
    const byName = byId ? [] : others.filter((a) => a.info.name.toLocaleLowerCase() === targetArg.toLocaleLowerCase());
    const target = byId ?? (byName.length === 1 ? byName[0] : null);

    if (!target) {
      if (byName.length > 1) {
        const lines = [`Multiple agents are named "${targetArg}". Re-run with the id:`];
        for (const a of byName) lines.push(`  \`${a.info.id}\``);
        addLogEntry(agentId, "system", lines.join("\n"));
      } else {
        addLogEntry(agentId, "system", `No agent matches \`${targetArg}\`. Run \`/bureau-message\` with no arguments to list agents.`);
      }
      updateState(agentId, "waiting_for_response");
      return true;
    }

    const sender = { kind: "agent" as const, agentId, agentName: managed.info.name, roomName: rooms[managed.info.room]!.name };
    const result = enqueueMessage(target.info.id, { sender, text });
    if (result.ok) {
      addLogEntry(agentId, "system", result.queued ? `Queued for **${target.info.name}** (busy — will flush when idle).` : `Delivered to **${target.info.name}**.`);
    } else {
      addLogEntry(agentId, "system", `Could not message **${target.info.name}**: ${result.error}`);
    }
    updateState(agentId, "waiting_for_response");
    return true;
  },

  async bureauDiff(agentId, managed, args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);

    const resolved = resolveDiffCwd(args[0], managed.info.cwd);
    if (resolved.kind === "bad_dir") {
      addLogEntry(agentId, "system", `\`${resolved.attempted}\` is not a directory.`);
      updateState(agentId, "waiting_for_response");
      return true;
    }

    const result = computeBureauDiff(resolved.cwd);
    switch (result.kind) {
      case "not_repo":
        addLogEntry(agentId, "system", `\`${result.cwd}\` is not a git repository.`);
        break;
      case "git_error":
        addLogEntry(agentId, "system", `Failed to run git diff in \`${result.cwd}\`:\n\n\`\`\`\n${result.message}\n\`\`\``);
        break;
      case "clean":
        addLogEntry(agentId, "system", `Working tree clean in \`${result.cwd}\` — no uncommitted changes.`);
        break;
      case "ok":
        addLogEntry(agentId, "diff", result.summary, undefined, undefined, { diff: result.payload });
        break;
    }
    updateState(agentId, "waiting_for_response");
    return true;
  },

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
