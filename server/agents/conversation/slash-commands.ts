import type { SkillInfo, SkillOrigin } from "../../../shared/types.ts";
import { MODEL_FAMILIES, EFFORT_LEVELS, familyDisplayLabel, effortDisplayLabel } from "../../../shared/types.ts";
import { computeBureauDiff, resolveDiffCwd } from "../../bureau-diff.ts";
import { resolveEditorPath, openFile as openEditorFile } from "../../file-editor.ts";
import { listAgentSessions } from "../../persistence.ts";
import { commands, type CommandConfig, unsupportedMessage } from "../commands.ts";
import { addLogEntry, agents, emit, emitEphemeralLog, isAgentBusy, logCache, officeConfig, persistAll, rooms, updateState, type ManagedAgent } from "../state.ts";
import { enqueueMessage } from "./send.ts";
import { resolveSkillPrompt } from "../skills-discovery.ts";
import { buildSystemPrompt } from "../session/system-prompt.ts";
import { listCronjobs, buildCronjobMemoryPrompt, buildCronjobSystemPrompt } from "../../cronjobs/index.ts";
import { SessionSwappedError, buildMemoryPromptForAgent, createSession, emitLoginInstructions, replaceSession } from "../session/runtime.ts";
import { tildifyCwd } from "../session/paths.ts";
import { runAgentTurn } from "../../plugins/run-agent-turn.ts";
import { persistCurrentSessionTopic } from "../topic.ts";
import { renderUsageReport } from "../usage.ts";

// ---------------------------------------------------------------------------
// Command handler registry — each supported command maps to a handler function.
// The handler key in commands.ts must match a key here.
// ---------------------------------------------------------------------------

type HandlerFn = (agentId: string, managed: ManagedAgent, args: string[], rawText: string, username?: string) => Promise<boolean>;

// Collapse alias entries into their canonical for display. Each output group
// carries the full name list (canonical + aliases) and a shared description.
// Used by /help to render e.g. `/diff (or /bureau-diff)` instead of two
// separate lines for the same handler.
type AliasItem = { name: string; description?: string; aliasFor?: string };
type AliasGroup = { names: string[]; description?: string };
function groupByAlias(items: AliasItem[]): AliasGroup[] {
  const canonicalIndex = new Map<string, AliasGroup>();
  for (const it of items) {
    if (it.aliasFor) continue;
    canonicalIndex.set(it.name, { names: [it.name], description: it.description });
  }
  for (const it of items) {
    if (!it.aliasFor) continue;
    const target = canonicalIndex.get(it.aliasFor);
    if (target) {
      target.names.push(it.name);
    } else {
      canonicalIndex.set(it.name, { names: [it.name], description: it.description });
    }
  }
  return Array.from(canonicalIndex.values());
}

// Render one alias group as a single bullet line. Shortest name leads
// (friendlier shorthand reads first); the rest go in parens.
function formatAliasGroup(names: string[], description?: string): string {
  const sorted = [...names].sort((a, b) => a.length - b.length);
  const primary = `\`/${sorted[0]}\``;
  const others = sorted.slice(1).map((n) => `\`/${n}\``);
  const head = others.length > 0 ? `${primary} (or ${others.join(", ")})` : primary;
  return description ? `  ${head} — ${description}` : `  ${head}`;
}

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
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);

    const lines: string[] = [];

    lines.push("**Docs:** https://github.com/dotbrains/bureau/tree/master/docs");

    // Tips — surfaced first so a new user reading top-down hits the
    // actionable stuff before the command/skill inventory.
    lines.push("\n**Tips:**");
    lines.push(
      "  • Agents can check on each other and message each other. Just ask naturally, or use `/bureau-peer-review`, `/bureau-pair-programming`, `/bureau-second-opinion`, `/bureau-soft-handoff`. Use `/bureau-message <agent> <text>` to drop a message straight into another agent's chat.",
    );
    lines.push('  • Type ahead while an agent is busy: messages queue and flush when it\'s idle. Hit "Send now" to interrupt and flush immediately.');
    lines.push("  • Use voice-to-text for faster prompting. The shortcut is ctrl+space.");
    lines.push(
      "  • Bureau works on your phone. The easiest way is to connect it to the same VPN (e.g., Tailscale - free) as the machine running it. On mobile the terminal opens as a full-screen overlay with Tab / Esc / Ctrl+C / Paste soft-keys.",
    );
    lines.push(
      "  • Once the office is reachable from outside your VPN (e.g. via Tailscale Funnel — see https://github.com/dotbrains/bureau/blob/master/docs/features/access-and-invites.md), the owner can open `User Settings → Access` and mint one-time invite URLs. Recipients click and are signed in — no accounts, no passwords.",
    );
    lines.push(
      "  • The built-in side-panel terminal is useful for one-off situations where you need to run something manually, like auth flows. The file editor side panel (toggle next to the terminal button) opens any file with CodeMirror.",
    );
    lines.push(
      "  • Agents can offer `[Open in editor]` and `[Copy to terminal]` cards in chat. Agents can also surface a file inline with POST /agents/:id/read-file — images render in-chat, others as a clickable chip.",
    );
    lines.push(
      "  • Use `/bureau-diff` to render uncommitted changes as a styled per-file card. Use `/bureau-edit <path>` to open a file in the editor side panel. Use `/bureau-usage` to see per-agent + per-room + per-cron-job lifetime cost.",
    );
    lines.push("  • The office view zooms and pans (pinch/scroll, drag, or `0`/`+`/`-` keys). Drag the splitter between chat and the side panel to resize it.");
    lines.push(
      "  • Pick a color theme from the header palette button — Dark, Light, Nord, Dracula, Solarized Dark, or Solarized Light. The moon/sun toggle bounces between your last-picked dark and light themes.",
    );
    lines.push("  • Schedule recurring work in the Cron Jobs page — daily, weekly, or by interval. Tasks have a Backlog status for deferred work.");
    lines.push("  • Bureau ships safety pre-tool-call hooks to prevent destructive commands like `rm -rf /`. `~/.bureau/` is auto-tarballed daily to `~/bureau-backups/` (last 7 kept).");

    // Commands — collapse aliased entries (e.g. `/diff` aliasFor `/bureau-diff`)
    // into a single line so the user doesn't see two lines for the same handler.
    const cmdGroups = groupByAlias(managed.slashCommands.map((c) => ({ name: c.name, description: c.description, aliasFor: c.aliasFor })));
    const cmdList = cmdGroups.map((g) => formatAliasGroup(g.names, g.description)).join("\n");
    lines.push(`\n**Commands:**\n${cmdList}`);

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
      const skillGroups = groupByAlias(skills.map((s) => ({ name: s.name, description: s.description, aliasFor: s.aliasFor })));
      const skillLines = skillGroups.map((g) => formatAliasGroup(g.names, g.description)).join("\n");
      lines.push(`\n**${originLabel[origin]}:**\n${skillLines}`);
    }

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
      // cwd is a property of the session \u2014 surface it so the user sees which
      // directory each session will resume into (it can differ per session).
      // Abbreviate the home prefix to `~` to save horizontal space.
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

  async bureauSystemPrompt(agentId, managed, _args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);
    const room = rooms[managed.info.room]!;
    const prompt = buildSystemPrompt(managed.info.name, agentId, room.name, officeConfig.prompt, room.prompt, managed.info.customInstructions, buildMemoryPromptForAgent(managed));
    // Pick a fence longer than any backtick run inside the prompt so the block
    // renders verbatim regardless of what office/room/agent prompts contain.
    const longestRun = (prompt.match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0);
    const fence = "`".repeat(Math.max(3, longestRun + 1));
    const header = "**Full system prompt** *(reflects current settings; takes effect on next conversation)*";
    addLogEntry(agentId, "system", `${header}\n\n${fence}plaintext\n${prompt}\n${fence}`);
    updateState(agentId, "waiting_for_response");
    return true;
  },

  async bureauCronjobSystemPrompt(agentId, _managed, args, rawText, username) {
    const userMeta = username ? { username } : undefined;
    addLogEntry(agentId, "user_message", rawText, userMeta);

    const query = args.join(" ").trim();
    const all = listCronjobs();

    if (!query) {
      const lines = ["Usage: `/bureau-cronjob-system-prompt <name-or-id>`"];
      if (all.length === 0) {
        lines.push("\nNo cron jobs are configured.");
      } else {
        lines.push("\nKnown cron jobs:");
        for (const c of all) lines.push(`  \`${c.id}\`  ${c.name}`);
      }
      addLogEntry(agentId, "system", lines.join("\n"));
      updateState(agentId, "waiting_for_response");
      return true;
    }

    const byId = all.find((c) => c.id === query);
    const byNameMatches = byId ? [] : all.filter((c) => c.name === query);
    const target = byId ?? (byNameMatches.length === 1 ? byNameMatches[0] : null);

    if (!target) {
      if (byNameMatches.length > 1) {
        const lines = [`Multiple cron jobs are named "${query}". Re-run with the id:`];
        for (const c of byNameMatches) lines.push(`  \`${c.id}\``);
        addLogEntry(agentId, "system", lines.join("\n"));
      } else {
        addLogEntry(agentId, "system", `No cron job matches \`${query}\`. Try \`/bureau-cronjob-system-prompt\` with no argument to list cron jobs.`);
      }
      updateState(agentId, "waiting_for_response");
      return true;
    }

    // The cronjob receives the system prompt + the configured prompt as its
    // first user message, so display both — that's the full initial input.
    const systemPrompt = buildCronjobSystemPrompt(target, target.id, "", buildCronjobMemoryPrompt());
    const combined = `${systemPrompt}\n\n----\nFirst user message:\n\n${target.prompt}`;
    const longestRun = (combined.match(/`+/g) ?? []).reduce((m, s) => Math.max(m, s.length), 0);
    const fence = "`".repeat(Math.max(3, longestRun + 1));
    const header = `**System prompt + first user message for cron job "${target.name}"** *(reflects current settings; takes effect on next run)*`;
    addLogEntry(agentId, "system", `${header}\n\n${fence}plaintext\n${combined}\n${fence}`);
    updateState(agentId, "waiting_for_response");
    return true;
  },

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

    // Reject self-send up front (matched against the live agent, not `others`).
    const self = managed.info;
    if (targetArg === self.id || targetArg.toLocaleLowerCase() === self.name.toLocaleLowerCase()) {
      addLogEntry(agentId, "system", "You can't message yourself.");
      updateState(agentId, "waiting_for_response");
      return true;
    }

    // Exact id match wins; otherwise case-insensitive name match.
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
  const inMultiStep = !!(managed.pendingPermission || managed.pendingResume || managed.pendingModelPick || managed.pendingEffortPick);
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
  const prefixedSkillPrompt = username ? `[${username}] ${fullPrompt}` : fullPrompt;
  try {
    await runAgentTurn({
      managed,
      visibleText: rawText,
      // For skills, the expanded skill prompt (with user args spliced in)
      // is the semantic user request — what the user effectively asked
      // the model to do. The raw `/grill` invocation is captured in
      // visibleText for display. Sender prefix is applied as sdkText.
      originalText: fullPrompt,
      sdkText: prefixedSkillPrompt,
      username: username ?? null,
      origin: "skill",
      humanInput: true,
    });
  } catch (err: any) {
    // runAgentTurn re-throws whatever the underlying turn threw and has
    // already cleaned up the pendingTurn deferred if session.send fell
    // before await turn. Per-site error semantics remain here.
    if (err instanceof SessionSwappedError) return true;
    addLogEntry(agentId, "error", `Skill error: ${err.message}`);
    updateState(agentId, "error");
  }
  return true;
}
