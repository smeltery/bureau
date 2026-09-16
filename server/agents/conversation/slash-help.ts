import type { SkillInfo } from "../../../shared/types.ts";
import { addLogEntry, updateState, type ManagedAgent } from "../state.ts";

const DOCS_URL = "https://github.com/smeltery/bureau/tree/master/docs";

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

function skillSection(lines: string[], label: string, skills: SkillInfo[]): void {
  if (skills.length === 0) return;
  const skillLines = groupByAlias(skills.map((s) => ({ name: s.name, description: s.description, aliasFor: s.aliasFor })))
    .map((g) => formatAliasGroup(g.names, g.description))
    .join("\n");
  lines.push(`\n## ${label}\n${skillLines}`);
}

export async function handleHelpCommand(agentId: string, managed: ManagedAgent, rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  addLogEntry(agentId, "user_message", rawText, userMeta);

  // Docs + a few short tips lead. Full command/skill inventories follow.
  // Phone/device and invite sprawl belong in the docs, not this pane.
  const lines: string[] = [
    `**Docs:** ${DOCS_URL}`,
    "",
    "**Tips:**",
    "  • Agents can check on each other and message each other. Ask naturally, or use `/bureau-peer-review`, `/bureau-pair-programming`, `/bureau-second-opinion`, `/bureau-soft-handoff`. Use `/bureau-message <agent> <text>` to drop a message into another agent's chat.",
    '  • Type ahead while an agent is busy: messages queue and flush when it\'s idle. Hit "Send now" to interrupt and flush immediately.',
    "  • Voice-to-text shortcut: ctrl+space.",
    "  • `/bureau-diff` for a styled diff card, `/bureau-edit <path>` for the editor panel, `/bureau-usage` for cost, `/bureau-storage` for persisted footprint.",
  ];

  // Collapse aliased entries (e.g. `/diff` aliasFor `/bureau-diff`) into one line.
  const cmdGroups = groupByAlias(managed.slashCommands.map((c) => ({ name: c.name, description: c.description, aliasFor: c.aliasFor })));
  const cmdList = cmdGroups.map((g) => formatAliasGroup(g.names, g.description)).join("\n");
  lines.push(`\n## Commands you can type\n${cmdList}`);

  // Two sections: skills Bureau ships, and everything else the reader brought.
  skillSection(
    lines,
    "Bureau Skills",
    managed.skills.filter((s) => s.origin === "bureau"),
  );
  skillSection(
    lines,
    "User Skills",
    managed.skills.filter((s) => s.origin !== "bureau"),
  );

  // Compact card header in the transcript; full body rides in metadata so it
  // stays out of the model context and doesn't clobber the chat.
  addLogEntry(agentId, "system", "**Help**", { helpContent: lines.join("\n") });
  updateState(agentId, "waiting_for_response");
  return true;
}
