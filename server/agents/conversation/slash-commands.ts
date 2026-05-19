import type { SkillInfo, SkillOrigin } from "../../../shared/types.ts";
import { MODEL_FAMILIES, familyDisplayLabel } from "../../../shared/types.ts";
import { computeBureauDiff, resolveDiffCwd } from "../../bureau-diff.ts";
import { listAgentSessions } from "../../persistence.ts";
import { commands, type CommandConfig, unsupportedMessage } from "../commands.ts";
import { addLogEntry, agents, beginTurn, emit, emitEphemeralLog, isAgentBusy, logCache, officeConfig, persistAll, rooms, updateState, type ManagedAgent } from "../state.ts";
import { enqueueMessage } from "./send.ts";
import { resolveSkillPrompt } from "../skills-discovery.ts";
import { buildSystemPrompt } from "../session/system-prompt.ts";
import { SessionSwappedError, createSession, createTurnDeferred, replaceSession } from "../session/runtime.ts";
import { persistCurrentSessionTopic } from "../topic.ts";
import { formatRelativeTime, renderUsageReport } from "../usage.ts";

// ---------------------------------------------------------------------------
// Command handler registry — each supported command maps to a handler function.
// The handler key in commands.ts must match a key here.
// ---------------------------------------------------------------------------

type HandlerFn = (agentId: string, managed: ManagedAgent, args: string[], rawText: string, username?: string) => Promise<boolean>;

const commandHandlers: Record<string, HandlerFn> = {
  async clear(agentId, managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    emitEphemeralLog(agentId, "user_message", rawText, userMeta);
    // Build the new session BEFORE destroying pending control state and the
    // message queue. If createSession throws (bad cwd, broken env, etc.) the
    // user sees a visible error and the prior pending/queue state stays
    // intact — they can retry or pick another recovery path. Once
    // createSession returns, the swap commits: pending/queue clear, topic
    // persists, replaceSession installs. Queue must clear BEFORE
    // replaceSession or the post-swap idle trigger flushes prior-context
    // messages into the fresh session.
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
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);

    const lines: string[] = [];

    // Agent metadata
    const topicLine = managed.info.topic ? `  Topic: ${managed.info.topic}` : "";
    lines.push(`**${managed.info.name}** — Room ${managed.info.room + 1}, Desk ${managed.info.desk + 1}`);
    lines.push(`  cwd: \`${managed.info.cwd}\``);
    if (topicLine) lines.push(topicLine);
    lines.push("");

    // Bureau description
    lines.push("Bureau is a multi-agent office manager for Claude Code. Learn more at https://");
    lines.push("");

    // Commands
    const cmdList = managed.slashCommands.map((c) => (c.description ? `  \`/${c.name}\`  — ${c.description}` : `  \`/${c.name}\``)).join("\n");
    lines.push(`**Commands:**\n${cmdList}`);

    // Skills grouped by origin
    const originLabel: Record<SkillOrigin, string> = {
      user: "User skills",
      project: "Project skills",
      plugin: "Plugin skills",
      bureau: "Bureau skills",
      claude: "Claude skills",
    };
    const originOrder: SkillOrigin[] = ["bureau", "user", "project", "plugin", "claude"];
    const grouped = new Map<SkillOrigin, SkillInfo[]>();
    for (const s of managed.skills) {
      if (!grouped.has(s.origin)) grouped.set(s.origin, []);
      grouped.get(s.origin)!.push(s);
    }
    for (const origin of originOrder) {
      const skills = grouped.get(origin);
      if (!skills || skills.length === 0) continue;
      const skillLines = skills
        .map((s) => {
          const desc = s.description ? ` — ${s.description}` : "";
          return `  \`/${s.name}\`${desc}`;
        })
        .join("\n");
      lines.push(`\n**${originLabel[origin]}:**\n${skillLines}`);
    }

    // Tips
    lines.push("\n**Tips:**");
    lines.push("  \u2022 Bureau also works on your phone. The easiest way is to connect it to the same tailscale network as the machine running it (it's free).");
    lines.push(
      "  \u2022 The built-in side-panel terminal is useful for one-off situations where you need to run something manually, like auth flows. On mobile it opens as a full-screen overlay with Tab / Esc / Ctrl+C / Paste soft-keys.",
    );
    lines.push("  \u2022 The file editor side panel (toggle next to the terminal button) opens any file with CodeMirror \u2014 tabs, syntax highlighting, and external-change detection.");
    lines.push(
      "  \u2022 Agents can offer `[Open in editor]` and `[Copy to terminal]` cards in chat (POST /agents/:id/edit-file and /terminal-command); click to open in the side panel. Agents can also surface a file inline with POST /agents/:id/read-file \u2014 images render in-chat, others as a clickable chip.",
    );
    lines.push("  \u2022 Drag the splitter between chat and the side panel to resize it. Widths persist per kind.");
    lines.push("  \u2022 Sending a message while an agent is busy queues it as a chip above the input; it flushes when the agent idles. Click \u00d7 on the chip to cancel.");
    lines.push("  \u2022 The office view zooms and pans: pinch or scroll to zoom, drag to pan, on-screen buttons in the bottom-right. Keyboard: `0` resets, `+`/`-` zoom.");
    lines.push("  \u2022 Bureau comes with safety pre-tool-call hooks to prevent destructive commands, like `rm -rf /`.");
    lines.push("  \u2022 Bureau agents can check what other agents are up to in real time. Just ask naturally.");
    lines.push("  \u2022 Use voice-to-text for faster prompting. The shortcut is ctrl+space.");
    lines.push("  \u2022 Use `/bureau-all-hands` to check what every agent is up to.");
    lines.push(
      "  \u2022 Use `/bureau-pair-programming` to walk through scoping, design review with a peer agent, and implementation review \u2014 escalates to the boss after 5 rounds or on architectural tradeoffs.",
    );
    lines.push("  \u2022 Use `/bureau-diff` to render uncommitted changes as a styled per-file card. Agents can also POST /agents/:id/diff with a commit or range.");
    lines.push(
      "  \u2022 Pick a color theme from the header palette button \u2014 Dark, Light, Nord, Dracula, Solarized Dark, or Solarized Light. The moon/sun toggle bounces between your last-picked dark and light themes.",
    );
    lines.push("  \u2022 Use `/bureau-usage` to see per-agent + per-room + per-cron-job lifetime cost.");
    lines.push("  \u2022 Schedule recurring work in the Cron Jobs page \u2014 daily, weekly, or by interval. Resume or edit-to-fork any past run.");
    lines.push("  \u2022 Tasks have a Backlog status \u2014 use it to defer work without it cluttering the active list.");
    lines.push("  \u2022 ~/.bureau/ is auto-tarballed daily to ~/bureau-backups/ (last 7 kept).");
    lines.push("  \u2022 Use `/report-bureau-bug` if you find any issues.");
    lines.push("  \u2022 Use `/bureau-grill-me` to make your feature designs more robust.");

    addLogEntry(agentId, "system", lines.join("\n"));
    updateState(agentId, "waiting_for_response");
    return true;
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
      if (s.sessionId === managed.sessionId) {
        lines.push(`  \u25cf ${label}  ${dateStr}  (current)`);
      } else {
        lines.push(`  ${num}. ${label}  ${dateStr}${suffix}`);
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

  async bureauAllHands(agentId, _managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);

    // Gather all agents grouped by room
    const allAgents = [...agents.values()];
    const roomMap = new Map<number, ManagedAgent[]>();
    for (const a of allAgents) {
      const room = a.info.room;
      if (!roomMap.has(room)) roomMap.set(room, []);
      roomMap.get(room)!.push(a);
    }

    const lines: string[] = [];
    const sortedRooms = [...roomMap.keys()].sort((a, b) => a - b);

    for (const room of sortedRooms) {
      const roomAgents = roomMap.get(room)!.sort((a, b) => a.info.desk - b.info.desk);
      lines.push(`**=== Room ${room + 1} ===**`);
      lines.push("");

      for (const a of roomAgents) {
        const selfTag = a.info.id === agentId ? "  **(me)**" : "";
        const modelLabel = familyDisplayLabel(a.info.modelFamily);
        lines.push(`**${a.info.name}** (desk ${a.info.desk + 1})${selfTag} — ${modelLabel} — \`${a.info.cwd}\``);

        const sessions = listAgentSessions(a.info.id);
        if (sessions.length === 0) {
          lines.push("  (no conversations)");
        } else {
          let num = 1;
          for (const s of sessions) {
            const label = s.topic || s.sessionId.slice(0, 8) + "...";
            const ago = formatRelativeTime(s.lastModified);
            lines.push(`  ${num}. ${label}  (${ago})`);
            num++;
          }
        }
        lines.push("");
      }
    }

    lines.push("Ask your agent if you'd like to know more about any agent or conversation.");

    addLogEntry(agentId, "system", lines.join("\n"));
    updateState(agentId, "waiting_for_response");
    return true;
  },

  async bureauSystemPrompt(agentId, managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);
    const room = rooms[managed.info.room]!;
    const prompt = buildSystemPrompt(managed.info.name, agentId, room.name, officeConfig.prompt, room.prompt, managed.info.customInstructions);
    // Pick a fence longer than any backtick run inside the prompt so the block
    // renders verbatim regardless of what office/room/agent prompts contain.
    const longestRun = (prompt.match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0);
    const fence = "`".repeat(Math.max(3, longestRun + 1));
    const header = "**Full system prompt** *(reflects current settings; takes effect on next conversation)*";
    addLogEntry(agentId, "system", `${header}\n\n${fence}plaintext\n${prompt}\n${fence}`);
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

// Startup assertion: every supported command with a handler key must have a matching handler
for (const [name, cfg] of Object.entries(commands)) {
  if (cfg.supported && cfg.handler && !commandHandlers[cfg.handler]) {
    throw new Error(`Command /${name} is marked supported with handler "${cfg.handler}" but no handler exists`);
  }
}

// ---------------------------------------------------------------------------
// Slash command resolution — 5-step priority order (see docs/slash-command-design.md)
// ---------------------------------------------------------------------------

export async function handleSlashCommand(agentId: string, managed: ManagedAgent, cmd: string, args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  const cfg: CommandConfig | undefined = commands[cmd];

  // Step 1: Config lookup (non-overridable)
  if (cfg && !cfg.overridable) {
    if (cfg.supported && cfg.handler && commandHandlers[cfg.handler]) {
      return commandHandlers[cfg.handler](agentId, managed, args, rawText, username);
    }
    // Unsupported non-overridable command — show message
    emitEphemeralLog(agentId, "user_message", rawText, userMeta);
    emitEphemeralLog(agentId, "system", unsupportedMessage(cmd));
    return true;
  }

  // Step 2: Skill override check (for overridable config entries OR unknown commands)
  const skillPrompt = resolveSkillPrompt(cmd, managed.info.cwd);
  if (skillPrompt) {
    return executeSkill(agentId, managed, skillPrompt, args, rawText, username);
  }

  // Step 3: Config lookup (overridable, no skill found)
  if (cfg && cfg.overridable) {
    if (cfg.supported && cfg.handler && commandHandlers[cfg.handler]) {
      return commandHandlers[cfg.handler](agentId, managed, args, rawText, username);
    }
    // Unsupported overridable command with no skill override
    emitEphemeralLog(agentId, "user_message", rawText, userMeta);
    emitEphemeralLog(agentId, "system", unsupportedMessage(cmd));
    return true;
  }

  // Step 4: SDK-reported commands — pass through to the agent via session.send()
  if (managed.sdkReportedCommands.includes(cmd)) {
    return false; // let sendMessage() pass it through
  }

  // Step 5: Unknown command
  emitEphemeralLog(agentId, "user_message", rawText, userMeta);
  emitEphemeralLog(agentId, "system", `Unknown command \`/${cmd}\`. Type \`/help\` to see available commands.`);
  return true;
}

// Execute a resolved skill prompt by sending it to the agent
async function executeSkill(agentId: string, managed: ManagedAgent, skillPrompt: string, args: string[], rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  const userArgs = args.join(" ");
  const fullPrompt = userArgs ? `${skillPrompt}\n\nUser context: ${userArgs}` : skillPrompt;

  // If the agent is mid-turn, defer the skill via the queue instead of
  // calling session.send now. Otherwise createTurnDeferred below would
  // supersede the in-flight turn and reject it with "Superseded by a new
  // turn". sendMessage's own queueing gate lets all slash commands skip
  // the queue — which is right for immediate handlers like /clear or
  // /bureau-diff, but wrong for skills that actually run the model.
  // Multi-step pending flows still take the immediate path: the user's
  // reply during /resume etc. is a pick, not a skill.
  const inMultiStep = !!(managed.pendingPermission || managed.pendingResume || managed.pendingModelPick);
  if (isAgentBusy(managed.info.state) && !inMultiStep) {
    const result = enqueueMessage(agentId, {
      sender: { kind: "user", username },
      text: rawText,
      sdkText: fullPrompt,
    });
    if (!result.ok) {
      addLogEntry(agentId, "system", `Could not queue ${rawText}: ${result.error}`);
    }
    return true;
  }

  addLogEntry(agentId, "user_message", rawText, userMeta);
  beginTurn(agentId, { humanInput: true });
  const prefixedSkillPrompt = username ? `[${username}] ${fullPrompt}` : fullPrompt;
  try {
    const turn = createTurnDeferred(managed);
    await managed.session!.send(prefixedSkillPrompt);
    await turn;
  } catch (err: any) {
    if (err instanceof SessionSwappedError) return true;
    addLogEntry(agentId, "error", `Skill error: ${err.message}`);
    updateState(agentId, "error");
  }
  return true;
}
