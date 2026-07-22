import type { SkillInfo, SkillOrigin } from "../../../shared/types.ts";
import { buildPublicOrigin } from "../../auth/auth.ts";
import { addLogEntry, updateState, type ManagedAgent } from "../state.ts";

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

export async function handleHelpCommand(agentId: string, managed: ManagedAgent, rawText: string, username?: string): Promise<boolean> {
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
  const publicOrigin = buildPublicOrigin();
  if (publicOrigin.source === "localhost") {
    lines.push(
      "  • Bureau works on your phone. The easiest way is to connect it to the same VPN (e.g., Tailscale - free) as the machine running it. On mobile the terminal opens as a full-screen overlay with Tab / Esc / Ctrl+C / Paste soft-keys.",
    );
    lines.push(
      "  • Once the office is reachable from outside your VPN (e.g. via Tailscale Funnel — see https://github.com/dotbrains/bureau/blob/master/docs/features/access-and-invites.md), the owner can open `User Settings → Access` and mint one-time invite URLs. Recipients click and are signed in — no accounts, no passwords.",
    );
  } else {
    lines.push(`  • Bureau works on your phone: open ${publicOrigin.origin}. On mobile the terminal opens as a full-screen overlay with Tab / Esc / Ctrl+C / Paste soft-keys.`);
    lines.push("  • The owner can open `User Settings → Access` and mint one-time invite URLs. Recipients click and are signed in — no accounts, no passwords.");
  }
  lines.push(
    "  • The built-in side-panel terminal is useful for one-off situations where you need to run something manually, like auth flows. The file editor side panel (toggle next to the terminal button) opens any file with CodeMirror.",
  );
  lines.push(
    "  • Agents can offer `[Open in editor]` and `[Copy to terminal]` cards in chat. Agents can also surface a file inline with POST /api/agents/:id/read-file — images render in-chat, others as a clickable chip.",
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
}
