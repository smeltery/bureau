import { logContent, logMessage, logParts, type LogParam } from "../../../shared/i18n/log-message.ts";
import { commandDescription } from "./command-messages.ts";
import { commands } from "../commands.ts";
import { addLogEntry, updateState, type ManagedAgent } from "../state.ts";

const DOCS_URL = "https://github.com/smeltery/bureau/tree/master/docs";

// Collapse alias entries into their canonical for display. Each output group
// carries the full name list (canonical + aliases) and a shared description.
// Used by /help to render e.g. `/diff (or /bureau-diff)` instead of two
// separate lines for the same handler.
type AliasItem = { name: string; description?: LogParam; aliasFor?: string };
type AliasGroup = { names: string[]; description?: LogParam };

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
function formatAliasGroup(names: string[], description?: LogParam): LogParam {
  const sorted = [...names].sort((a, b) => a.length - b.length);
  const primary = `\`/${sorted[0]}\``;
  const others = sorted.slice(1).map((n) => `\`/${n}\``);
  const head = others.length > 0 ? logMessage("logs.help.aliases", { primary, others: others.join(", ") }) : primary;
  return description ? logMessage("logs.help.commandRow", { names: head, description }) : logMessage("logs.help.commandOnly", { names: head });
}

export async function handleHelpCommand(agentId: string, managed: ManagedAgent, rawText: string, username?: string): Promise<boolean> {
  const userMeta = username ? { username } : undefined;
  addLogEntry(agentId, "user_message", rawText, userMeta);

  // Docs + a few short tips lead. The command inventory and skills link follow.
  // Phone/device and invite sprawl belong in the docs, not this pane.
  const lines: LogParam[] = [
    logMessage("logs.help.docs", { url: DOCS_URL }),
    "",
    logMessage("logs.help.tips"),
    logMessage("logs.help.peers", { command: "/bureau-message <agent> <text>" }),
    logMessage("logs.help.queue"),
    logMessage("logs.help.voice"),
    logMessage("logs.help.tools", { editCommand: "/bureau-edit <path>" }),
  ];

  const cmdGroups = groupByAlias(
    managed.slashCommands.map((command) => {
      const overridden = commands[command.name]?.overridable && managed.skills.some((skill) => skill.name === command.name);
      return { name: command.name, aliasFor: command.aliasFor, description: overridden ? command.description : commandDescription(command.name, command.description) };
    }),
  );
  lines.push(logMessage("logs.help.commands"));
  lines.push(...cmdGroups.map((group) => formatAliasGroup(group.names, group.description)));
  lines.push(logMessage("logs.help.skills"));
  const body = logParts(lines.flatMap((line, index) => (index ? ["\n", line] : [line])));

  // Compact card header in the transcript; full body rides in metadata so it
  // stays out of the model context and doesn't clobber the chat.
  addLogEntry(agentId, "system", logMessage("logs.help.header"), { helpContent: logContent(body).content, helpMessage: body });
  updateState(agentId, "waiting_for_response");
  return true;
}
